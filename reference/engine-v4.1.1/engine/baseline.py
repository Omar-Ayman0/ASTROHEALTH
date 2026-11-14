"""
Personal baseline.

v1 used one flat mean/std per vital over 24 h. With a circadian rhythm in the
data that inflates sigma (HR sigma 3.9 bpm when the true noise is ~1.8) and
makes the same z-score mean different things at 03:00 and at 15:00.

v2 models each vital as:   expected(t) = a + b*sin(2*pi*t/24) + c*cos(2*pi*t/24)
fitted by least squares on the calibration window using only valid, non-exercise
rows. The deviation is measured against expected(t) in units of the *residual*
SD ("sigma"). The 24 h term is kept only if it explains a meaningful share of the
variance (CIRCADIAN_MIN_R2) and the calibration spans enough hours; otherwise the
model falls back to the flat mean (so it is safe on short or noisy calibration).

`use_circadian=False` reproduces the v1 behaviour (used for the ablation study).
"""
import numpy as np
import pandas as pd

from engine.config import (
    VITAL_COLUMNS, BASELINE_WINDOW_STEPS, MIN_CALIBRATION_ROWS, MIN_CIRCADIAN_SPAN_HOURS,
    CIRCADIAN_MIN_R2, MIN_RESIDUAL_STD, ACTIVE_STATES, TREND_WINDOW_STEPS,
    TREND_MIN_PERIODS, TREND_K, TREND_Z_MIN, TREND_VITALS,
)


def hour_of_day(ts) -> np.ndarray:
    s = pd.Series(pd.to_datetime(ts))
    return (s.dt.hour + s.dt.minute / 60.0 + s.dt.second / 3600.0).to_numpy(dtype=float)


def _design(hours: np.ndarray, sleep: np.ndarray | None = None) -> np.ndarray:
    """[1, sin(24h), cos(24h), is_sleeping] - the baseline knows the astronaut's state."""
    w = 2 * np.pi * hours / 24.0
    sl = np.zeros_like(hours) if sleep is None else np.asarray(sleep, dtype=float)
    return np.column_stack([np.ones_like(hours), np.sin(w), np.cos(w), sl])


def _sleep_flags(df) -> np.ndarray:
    if "activity_state" not in df:
        return np.zeros(len(df))
    return (df["activity_state"] == "SLEEP").to_numpy(dtype=float)


class PersonalBaselineModel:
    def __init__(self, use_circadian: bool = True):
        self.use_circadian = use_circadian
        self.profile: dict = {}

    # ------------------------------------------------------------------ fit
    def fit(self, df: pd.DataFrame, calibration_steps: int = BASELINE_WINDOW_STEPS) -> dict:
        calib = df.iloc[:calibration_steps]
        state = calib.get("activity_state", pd.Series("UNKNOWN", index=calib.index))
        ok = (calib["is_corrupted_detected"] == 0) & (~state.isin(ACTIVE_STATES))
        valid = calib[ok]
        if len(valid) < MIN_CALIBRATION_ROWS:
            raise ValueError(
                f"Not enough valid calibration rows ({len(valid)} < {MIN_CALIBRATION_ROWS}); "
                "cannot build a personal baseline."
            )

        hours = hour_of_day(valid["timestamp"])
        sleep_c = _sleep_flags(valid)
        if sleep_c.sum() < 20:                 # not enough sleep rows to estimate a sleep effect
            sleep_c = np.zeros_like(sleep_c)
        span_h = (pd.to_datetime(valid["timestamp"]).max() - pd.to_datetime(valid["timestamp"]).min()
                  ).total_seconds() / 3600.0
        grid = np.arange(0, 24, 0.25)

        metrics = {}
        for col in VITAL_COLUMNS:
            y = valid[col].to_numpy(dtype=float)
            X = _design(hours, sleep_c)
            raw_std = float(np.std(y, ddof=1))

            use = False
            beta = np.array([float(np.mean(y)), 0.0, 0.0, 0.0])
            r2 = 0.0
            if self.use_circadian and span_h >= MIN_CIRCADIAN_SPAN_HOURS:
                b, *_ = np.linalg.lstsq(X, y, rcond=None)
                resid = y - X @ b
                r2 = 1.0 - float(np.var(resid)) / float(np.var(y)) if np.var(y) > 0 else 0.0
                if r2 >= CIRCADIAN_MIN_R2:
                    beta, use = b, True

            resid = y - X @ beta
            if use:
                resid_std = float(np.std(resid, ddof=4))
            else:
                resid_std = raw_std
            resid_std = max(resid_std, MIN_RESIDUAL_STD[col])

            amp = float(np.hypot(beta[1], beta[2]))
            phi = np.arctan2(beta[2], beta[1])
            peak_hour = float((24.0 * (np.pi / 2 - phi) / (2 * np.pi)) % 24.0) if use else None
            curve = _design(grid) @ beta        # awake curve; sleep shift added below
            curve = np.concatenate([curve, curve + beta[3]])
            q25, q75 = np.percentile(y, [25, 75])

            metrics[col] = {
                "mean": round(float(beta[0]), 3),
                "std": round(resid_std, 3),                  # sigma used for z-scores
                "raw_std": round(raw_std, 3),                # total SD (what v1 used)
                "median": round(float(np.median(y)), 3),
                "iqr": round(float(q75 - q25), 3),
                "normal_min": round(float(curve.min() - 2 * resid_std), 3),
                "normal_max": round(float(curve.max() + 2 * resid_std), 3),
                "model": "circadian" if use else "flat",
                "circadian_amplitude": round(amp, 3) if use else 0.0,
                "circadian_peak_hour": round(peak_hour, 2) if peak_hour is not None else None,
                "sleep_effect": round(float(beta[3]), 3) if use else 0.0,
                "variance_explained": round(r2, 3) if use else 0.0,
                "coef": [round(float(v), 6) for v in beta],
            }

        profile = {
            "astronaut_id": str(df["astronaut_id"].iloc[0]),
            "calibration_samples": int(len(valid)),
            "calibration_hours": round(span_h, 1),
            "calibration_ends": str(pd.to_datetime(calib["timestamp"]).max()),
            "use_circadian": bool(self.use_circadian),
            "metrics": metrics,
        }
        self.profile = profile
        # personal "how noisy is a 1 h rolling mean" -> data-driven trend threshold
        profile["trend_thresholds"] = self._trend_thresholds(calib, ok)
        return profile

    # ---------------------------------------------------------- scoring ----
    @classmethod
    def from_profile(cls, profile: dict) -> "PersonalBaselineModel":
        m = cls(use_circadian=profile.get("use_circadian", True))
        m.profile = profile
        return m

    def expected(self, col: str, timestamps, sleep=None) -> np.ndarray:
        beta = np.asarray(self.profile["metrics"][col]["coef"], dtype=float)
        if len(beta) == 3:                      # profiles stored by v1-style fits
            beta = np.append(beta, 0.0)
        return _design(hour_of_day(timestamps), sleep) @ beta

    def sigma(self, col: str) -> float:
        return float(self.profile["metrics"][col]["std"])

    def zscores(self, df: pd.DataFrame) -> pd.DataFrame:
        """expected_* and z_* (unmasked) for every vital."""
        out = pd.DataFrame(index=df.index)
        for col in VITAL_COLUMNS:
            exp = self.expected(col, df["timestamp"], _sleep_flags(df))
            out[f"{col}_expected"] = exp
            out[f"{col}_zscore"] = (df[col].to_numpy(dtype=float) - exp) / self.sigma(col)
        return out

    def _trend_thresholds(self, calib: pd.DataFrame, ok: pd.Series) -> dict:
        z = self.zscores(calib)
        thr = {}
        for col in TREND_VITALS:
            zc = z[f"{col}_zscore"].where(ok.to_numpy())
            roll = zc.rolling(TREND_WINDOW_STEPS, min_periods=TREND_MIN_PERIODS).mean()
            sd = float(roll.std()) if roll.notna().sum() > 10 else 0.5
            thr[col] = round(max(TREND_Z_MIN, TREND_K * sd), 3)
        return thr
