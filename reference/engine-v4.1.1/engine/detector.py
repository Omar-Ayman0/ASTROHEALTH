"""
Hybrid anomaly detector.

Three independent detectors, combined:
  1. STAT   - single-reading deviation: |z| >= 3 sigma against the personal,
              time-of-day aware baseline.
  2. TREND  - sustained shift: |rolling 1 h mean of z| >= a threshold learned from
              this astronaut's own calibration noise (handles autocorrelation).
  3. ML     - Isolation Forest trained on calibration z-scores. Its alarm budget is
              set explicitly (1 % of calibration rows). It is NOT a disease prevalence
              and the model never alarms alone: it must be confirmed by |z| >= ML_GATE_Z.

hybrid = STAT or TREND or (ML and |z| >= ML_GATE_Z)

Context: during planned activity (activity_state == ACTIVE) HR / HRV / respiration /
temperature are expected to move, so they are not scored (SpO2 still is).
Rows flagged as sensor artifacts are never scored.

Everything is causal (rolling windows look backwards only) so the batch result for
a row equals what a live stream would have produced for that row.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from engine.baseline import PersonalBaselineModel
from engine.evidence import label
from engine.config import (
    VITAL_COLUMNS, BASELINE_WINDOW_STEPS, Z_SCORE_THRESHOLD, TREND_WINDOW_STEPS,
    TREND_MIN_PERIODS, TREND_VITALS, TREND_Z_MIN, ML_CALIBRATION_QUANTILE, ML_GATE_Z,
    Z_SATURATION, ACTIVE_STATES, CONTEXT_MASKED_VITALS, ALERT_MIN_CONSECUTIVE,
    ALERT_Z_OVERRIDE,
)

Z_COLS = [f"{c}_zscore" for c in VITAL_COLUMNS]


class HealthIntelligenceDetector:
    def __init__(self, baseline: PersonalBaselineModel, random_state: int = 42,
                 use_ml: bool = True, use_context: bool = True):
        self.baseline = baseline
        self.use_ml = use_ml
        self.use_context = use_context
        self.iso_forest = IsolationForest(
            n_estimators=100, contamination="auto", random_state=random_state
        )
        self.ml_threshold: float | None = None

    # ---------------------------------------------------------------- ML ---
    def _scored_z(self, df: pd.DataFrame) -> pd.DataFrame:
        """z-scores with invalid / out-of-context entries masked to NaN."""
        z = self.baseline.zscores(df)
        valid = (df["is_corrupted_detected"] == 0).to_numpy()
        if self.use_context:
            active = df["activity_state"].isin(ACTIVE_STATES).to_numpy()
        else:
            active = np.zeros(len(df), dtype=bool)
        for col in VITAL_COLUMNS:
            name = f"{col}_zscore"
            z.loc[~valid, name] = np.nan
            if col in CONTEXT_MASKED_VITALS:
                z.loc[active, name] = np.nan
        return z

    def fit_ml(self, df: pd.DataFrame, calibration_steps: int = BASELINE_WINDOW_STEPS):
        if not self.use_ml:
            return self
        calib = df.iloc[:calibration_steps]
        z = self._scored_z(calib)[Z_COLS].dropna()
        if len(z) < 50:
            self.use_ml = False
            return self
        self.iso_forest.fit(z.to_numpy())
        scores = self.iso_forest.decision_function(z.to_numpy())
        self.ml_threshold = float(np.quantile(scores, ML_CALIBRATION_QUANTILE))
        return self

    # ----------------------------------------------------------- analysis --
    def analyze(self, df: pd.DataFrame, calibration_rows: int = 0) -> pd.DataFrame:
        res = df.copy()
        z = self._scored_z(df)
        for c in z.columns:
            res[c] = z[c].to_numpy()

        valid = (res["is_corrupted_detected"] == 0)
        zv = res[Z_COLS]
        res["max_abs_zscore"] = zv.abs().max(axis=1).fillna(0.0)
        res["stat_anomaly"] = ((res["max_abs_zscore"] >= Z_SCORE_THRESHOLD) & valid).astype(int)

        # ML (needs a complete, in-context feature vector)
        res["ml_anomaly"] = 0
        if self.use_ml and self.ml_threshold is not None:
            complete = zv.notna().all(axis=1) & valid
            if complete.any():
                dec = self.iso_forest.decision_function(zv[complete].to_numpy())
                res.loc[complete, "ml_anomaly"] = (dec < self.ml_threshold).astype(int)

        # sustained trend on rolling mean of z
        thr = self.baseline.profile.get("trend_thresholds", {})
        trend_flag = pd.Series(False, index=res.index)
        trend_abs = pd.DataFrame(index=res.index)
        for col in TREND_VITALS:
            zc = res[f"{col}_zscore"]
            roll = zc.rolling(TREND_WINDOW_STEPS, min_periods=TREND_MIN_PERIODS).mean()
            roll = roll.where(zc.notna())          # only score rows where this vital is in context
            res[f"{col}_trend_z"] = roll
            trend_abs[col] = roll.abs()
            trend_flag |= (roll.abs() >= thr.get(col, TREND_Z_MIN)).fillna(False)
        res["trend_drift_flag"] = (trend_flag & valid).astype(int)
        res["max_abs_trend_z"] = trend_abs.max(axis=1).fillna(0.0)

        res["hybrid_anomaly"] = (
            (res["stat_anomaly"] == 1)
            | (res["trend_drift_flag"] == 1)
            | ((res["ml_anomaly"] == 1) & (res["max_abs_zscore"] >= ML_GATE_Z))
        ).astype(int)

        if calibration_rows > 0:
            cols = ["stat_anomaly", "ml_anomaly", "trend_drift_flag", "hybrid_anomaly"]
            res.iloc[:calibration_rows, [res.columns.get_loc(c) for c in cols]] = 0

        # score: deviation in sigmas mapped to 0..1 (a defined scale, NOT a probability)
        deviation = np.maximum(res["max_abs_zscore"], res["max_abs_trend_z"])
        res["anomaly_score"] = np.where(valid, np.clip(deviation / Z_SATURATION, 0.0, 1.0), 0.0).round(3)

        # alert gating (batch version of the streaming rule)
        h = res["hybrid_anomaly"]
        grp = (h == 0).cumsum()
        res["consecutive_hybrid"] = h.groupby(grp).cumsum()
        res["trigger_alert"] = (
            (h == 1) & ((res["consecutive_hybrid"] >= ALERT_MIN_CONSECUTIVE)
                        | (res["max_abs_zscore"] >= ALERT_Z_OVERRIDE))
        ).astype(int)

        res["context"] = np.where(
            ~valid, "SENSOR_ARTIFACT",
            np.where(res["activity_state"].isin(ACTIVE_STATES) & self.use_context,
                     "PLANNED_ACTIVITY", "REST_OR_SLEEP"),
        )
        res["explanation"] = self._explain(res)
        return res

    # --------------------------------------------------------- explanation --
    def _explain(self, res: pd.DataFrame) -> list[str]:
        thr = self.baseline.profile.get("trend_thresholds", {})
        out = ["Nominal telemetry within personal baseline."] * len(res)
        interesting = np.flatnonzero(
            (res["is_corrupted_detected"].to_numpy() == 1) | (res["hybrid_anomaly"].to_numpy() == 1)
        )
        cols = list(res.columns)
        for i in interesting:
            row = res.iloc[i]
            if row["is_corrupted_detected"] == 1:
                out[i] = f"Sensor artifact excluded from analysis ({row['corruption_reason']})."
                continue
            parts = []
            order = sorted(VITAL_COLUMNS, key=lambda c: -abs(row[f"{c}_zscore"])
                           if pd.notna(row[f"{c}_zscore"]) else 0)
            for c in order:
                zc = row[f"{c}_zscore"]
                if pd.notna(zc) and abs(zc) >= 2.0:
                    direction = "elevated" if zc > 0 else "depressed"
                    exp = row[f"{c}_expected"]
                    parts.append(f"{label(c)} {direction} ({row[c]:.4g} vs expected {exp:.4g} at this time of day, z={zc:+.1f})")
            for c in TREND_VITALS:
                tz = row.get(f"{c}_trend_z", np.nan)
                if pd.notna(tz) and abs(tz) >= thr.get(c, TREND_Z_MIN):
                    parts.append(f"{label(c)} sustained shift over 1 h (mean z={tz:+.1f}, threshold {thr.get(c, TREND_Z_MIN):.1f})")
            if not parts:
                parts.append("multivariate deviation flagged by Isolation Forest and confirmed by |z|>=2")
            out[i] = " | ".join(parts)
        return out
