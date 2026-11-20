"""
Health Intelligence Engine - single entry point for Backend / n8n / Dashboard.

    engine = HealthEngine().fit(raw_df)            # personal baseline + ML calibration
    result = engine.analyze(raw_df)                # batch: result["report"] is the JSON contract
    session = engine.start_stream(raw_df.iloc[:576])
    tick = session.push({...one reading...})       # REAL per-reading analysis (not a replay)

    analyze_health(data, baseline)                 # the function signature agreed in the plan

The JSON contract is documented in docs/JSON_CONTRACT.md.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from engine.baseline import PersonalBaselineModel
from engine.config import (
    VITAL_COLUMNS, BASELINE_WINDOW_STEPS, MODEL_VERSION, SCHEMA_VERSION, DISCLAIMER,
    STATUS_WINDOW_STEPS, STREAM_BUFFER_STEPS, ALERT_MIN_CONSECUTIVE, ALERT_Z_OVERRIDE,
    Z_SCORE_THRESHOLD, Z_SATURATION, ACTIVE_STATES, CONTEXT_MASKED_VITALS, PLAUSIBILITY_BOUNDS,
)
from engine.detector import HealthIntelligenceDetector
from engine.evidence import label
from engine.trend_analysis import extract_events, sleep_analysis, current_trends
from engine.validator import TelemetryValidator

SCORE_DEFINITION = (
    "anomaly_score = min(1, deviation / 6) where deviation = max(|z| of the latest reading, "
    "|1 h rolling-mean z|) in units of the astronaut's own baseline sigma. "
    "0.5 = 3 sigma, 0.67 = 4 sigma. It is a deviation scale, NOT a probability of illness."
)


# --------------------------------------------------------------- json utils --
def to_jsonable(obj):
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (pd.Timestamp, datetime)):
        return str(obj)
    if obj is pd.NaT:
        return None
    return obj


# ------------------------------------------------------------------ engine --
class HealthEngine:
    def __init__(self, use_circadian: bool = True, use_context: bool = True,
                 use_ml: bool = True, random_state: int = 42):
        self.use_circadian = use_circadian
        self.use_context = use_context
        self.use_ml = use_ml
        self.random_state = random_state
        self.validator = TelemetryValidator()
        self.baseline: PersonalBaselineModel | None = None
        self.detector: HealthIntelligenceDetector | None = None
        self.calibration_steps = BASELINE_WINDOW_STEPS

    # ------------------------------------------------------------- fitting --
    def fit(self, raw_df: pd.DataFrame, calibration_steps: int = BASELINE_WINDOW_STEPS) -> "HealthEngine":
        self.calibration_steps = calibration_steps
        validated = self.validator.validate(raw_df.reset_index(drop=True))
        self.baseline = PersonalBaselineModel(self.use_circadian)
        profile = self.baseline.fit(validated, calibration_steps)
        calib = validated.iloc[:calibration_steps]
        sl = sleep_analysis(calib, profile["calibration_ends"])
        profile["sleep_baseline_hours"] = sl.get("baseline_hours")
        profile["sleep_baseline_nights"] = sl.get("baseline_nights", 0)
        self.detector = HealthIntelligenceDetector(
            self.baseline, self.random_state, self.use_ml, self.use_context
        ).fit_ml(validated, calibration_steps)
        return self

    @classmethod
    def from_baseline(cls, profile: dict, use_context: bool = True) -> "HealthEngine":
        """Rules-only engine rebuilt from a stored baseline JSON (no ML model is stored)."""
        e = cls(use_circadian=profile.get("use_circadian", True), use_context=use_context, use_ml=False)
        e.baseline = PersonalBaselineModel.from_profile(profile)
        e.detector = HealthIntelligenceDetector(e.baseline, e.random_state, use_ml=False,
                                                use_context=use_context)
        e.calibration_steps = 0
        return e

    @property
    def profile(self) -> dict:
        return self.baseline.profile

    @property
    def model_version(self) -> str:
        return MODEL_VERSION if (self.detector.use_ml and self.detector.ml_threshold is not None) \
            else "rules-v2.0"

    # ------------------------------------------------------------ analysis --
    def analyze(self, raw_df: pd.DataFrame, data_source: dict | None = None,
                calibration_rows: int | None = None, events: list | None = None,
                sleep: dict | None = None, run: int = 1) -> dict:
        """calibration_rows: leading rows that belong to the calibration window (their flags are
        zeroed). Default = the window this engine was fitted on; pass 0 for new, post-calibration data.
        events / sleep: optional precomputed values (the live system passes its full-history ones)."""
        cal = self.calibration_steps if calibration_rows is None else calibration_rows
        raw_df = raw_df.reset_index(drop=True)
        validated = self.validator.validate(raw_df)
        res = self.detector.analyze(validated, calibration_rows=cal)
        quality = self.validator.quality_report(validated)
        if events is None:
            events = extract_events(res, self.profile, run)
        if sleep is None:
            stored_sleep = self.profile.get("sleep_baseline_hours") if cal == 0 else None
            sleep = sleep_analysis(res, self.profile.get("calibration_ends"), baseline_hours=stored_sleep)
        trends = current_trends(res, self.profile)
        report = build_report(res, self.profile, quality, events, sleep, trends,
                              self.model_version, data_source, cal)
        return {"df": res, "events": events, "sleep": sleep, "trends": trends,
                "quality": quality, "report": report}

    # ----------------------------------------------------------- streaming --
    def start_stream(self, history_raw_df: pd.DataFrame) -> "StreamSession":
        return StreamSession(self, history_raw_df)


# ----------------------------------------------------------------- report ---
def _observed_block(res: pd.DataFrame, profile: dict) -> dict:
    window = res.tail(STATUS_WINDOW_STEPS)
    last_valid = res[res["is_corrupted_detected"] == 0].tail(1)
    out = {"window_hours": round(STATUS_WINDOW_STEPS * 5 / 60, 1), "vitals": {}}
    for col in VITAL_COLUMNS:
        ok = window["is_corrupted_detected"] == 0
        if col in CONTEXT_MASKED_VITALS:
            ok &= ~window["activity_state"].isin(ACTIVE_STATES)
        w = window[ok]
        sigma = profile["metrics"][col]["std"]
        if len(w):
            resid = (w[col] - w[f"{col}_expected"]).mean()
            block = {
                "window_mean": round(float(w[col].mean()), 3),
                "expected_window_mean": round(float(w[f"{col}_expected"].mean()), 3),
                "window_mean_zscore": round(float(resid / sigma), 2),
            }
        else:
            block = {"window_mean": None, "expected_window_mean": None, "window_mean_zscore": None}
        if len(last_valid):
            r = last_valid.iloc[0]
            block["latest_value"] = round(float(r[col]), 3)
            block["expected_now"] = round(float(r[f"{col}_expected"]), 3)
            block["latest_timestamp"] = str(r["timestamp"])
        out["vitals"][col] = block
    return out


def _latest_vitals(res: pd.DataFrame) -> dict:
    """Last reading per vital with its expected value and z-score (z is null when the reading
    is invalid or masked by planned activity)."""
    last = res.iloc[-1]
    out = {"timestamp": str(last["timestamp"]), "activity_state": str(last["activity_state"]),
           "is_corrupted": bool(last["is_corrupted_detected"] == 1), "vitals": {}}
    for col in VITAL_COLUMNS:
        out["vitals"][col] = {"value": last[col], "expected": last[f"{col}_expected"],
                              "zscore": last[f"{col}_zscore"]}
    return out


def _key_findings(status, reason, active_event, trends, sleep, quality) -> list:
    f = [reason]
    if active_event:
        for v in active_event["vitals_involved"][:3]:
            f.append(f"{label(v['vital'])} {v['direction']}: observed {v['observed_mean']} vs expected "
                     f"{v['expected_mean']} (mean z={v['mean_zscore']:+.1f}, baseline sigma {v['baseline_sigma']})")
        f.append(f"Review reason: {active_event['review_reason']}")
    for t in trends:
        if t["status"] == "DRIFT_WARNING":
            f.append(f"{label(t['metric'])} trending {t['direction'].lower()} ({t['slope_per_hour']:+.2f} per hour over the last 3 h)")
    if sleep.get("status") in ("SLEEP_RESTRICTION_TREND", "SHORT_SLEEP_WATCH"):
        f.append(f"Sleep: {sleep['consecutive_short_nights']} consecutive night(s) at least 1 h below the "
                 f"personal baseline of {sleep['baseline_hours']} h")
    if quality["status"] != "HEALTHY_STREAM":
        f.append(f"Data quality: {quality['status']} ({quality['data_quality_score_pct']} % valid, "
                 f"{quality['current_invalid_run_steps']} consecutive invalid readings now)")
    return f


def build_report(res: pd.DataFrame, profile: dict, quality: dict, events: list, sleep: dict,
                 trends: list, model_version: str, data_source: dict | None,
                 calibration_steps: int) -> dict:
    astro = str(res["astronaut_id"].iloc[0])
    window = res.tail(STATUS_WINDOW_STEPS)
    n_flag = int(window["hybrid_anomaly"].sum())
    n_alert = int(window["trigger_alert"].sum())
    score = float(window["anomaly_score"].max()) if len(window) else 0.0
    window_start = window["timestamp"].iloc[0] if len(window) else None
    active_event = next((e for e in reversed(events)
                         if window_start is not None and pd.Timestamp(e["end"]) >= window_start), None)

    if quality["status"] == "INSUFFICIENT_DATA":
        status = "INSUFFICIENT_DATA"
        reason = ("Stream currently unusable: "
                  f"{quality['current_invalid_run_steps']} consecutive invalid readings, "
                  f"{quality['recent_invalid_fraction']:.0%} of the last 3 h invalid. No health conclusion is drawn.")
    elif n_alert >= 1:
        status = "REVIEW_REQUIRED"
        reason = active_event["explanation"] if active_event else "Sustained deviation from personal baseline."
    elif n_flag >= 2:
        status = "MONITOR_CLOSELY"
        reason = active_event["explanation"] if active_event else "Repeated deviation from personal baseline."
    elif sleep.get("status") in ("SLEEP_RESTRICTION_TREND", "SHORT_SLEEP_WATCH"):
        status = "MONITOR_CLOSELY"
        reason = (f"Sleep duration is below the personal baseline ({sleep.get('baseline_hours')} h): "
                  f"{sleep.get('consecutive_short_nights')} consecutive short night(s).")
    else:
        status = "NOMINAL"
        reason = ("Last 3 h are within the personal time-of-day baseline."
                  if n_flag == 0 else
                  "One isolated reading beyond 3 sigma in the last 3 h; treated as noise-level (no persistence).")

    post = res.iloc[calibration_steps:]
    summary = {
        "analysed_rows": int(len(post)),
        "statistical_flags": int(post["stat_anomaly"].sum()),
        "isolation_forest_flags": int(post["ml_anomaly"].sum()),
        "trend_flags": int(post["trend_drift_flag"].sum()),
        "hybrid_flags": int(post["hybrid_anomaly"].sum()),
        "events_total": len(events),
        "events_needing_review": int(sum(e["needs_human_review"] for e in events)),
        "low_deviation_events_hidden": int(sum(e["severity"] == "LOW_DEVIATION" for e in events)),
        "sensor_artifact_rows": int(res["is_corrupted_detected"].sum()),
    }
    review_events = [e for e in events if e["needs_human_review"]]
    latest_event = review_events[-1] if review_events else None
    severity = (active_event or {}).get("severity", "NONE") if status != "INSUFFICIENT_DATA" else "NONE"
    findings = _key_findings(status, reason, active_event, trends, sleep, quality)
    src = {"type": "unspecified", "is_real_astronaut_data": False,
           "engine_reads_ground_truth_columns": False}
    if data_source:
        src.update(data_source)

    return to_jsonable({
        "schema_version": SCHEMA_VERSION,
        "astronaut_id": astro,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_version": model_version,
        "disclaimer": DISCLAIMER,
        "latest_reading_at": str(res["timestamp"].iloc[-1]),
        "status": status,
        "severity": severity,
        "needs_human_review": status == "REVIEW_REQUIRED",
        "anomaly_score": round(score, 3),
        "anomaly_score_definition": SCORE_DEFINITION,
        "reason": reason,
        "key_findings": findings,
        "latest_event_id": latest_event["event_id"] if latest_event else None,
        "latest_vitals": _latest_vitals(res),
        "data_source": src,
        "data_quality": quality,
        "baseline": profile,
        "observed": _observed_block(res, profile),
        "trend_analysis": trends,
        "sleep": sleep,
        "active_event": active_event,
        "events": [e for e in events if e["severity"] != "LOW_DEVIATION"][-25:],
        "summary_metrics": summary,
    })


# ------------------------------------------------------------------ stream --
class StreamSession:
    """Per-reading analysis. Keeps a short rolling buffer and re-runs the *same*
    validator + detector on it, so a live tick matches the batch result for that row."""

    def __init__(self, engine: HealthEngine, history_raw_df: pd.DataFrame):
        self.engine = engine
        hist = history_raw_df.reset_index(drop=True)
        self.buf = hist.tail(STREAM_BUFFER_STEPS).reset_index(drop=True)
        self.step = len(hist)               # global index of the next reading
        self.consecutive = 0

    def push(self, reading: dict) -> dict:
        eng = self.engine
        row = {c: np.nan for c in self.buf.columns}
        row.update(reading)
        for k in row:
            if k not in self.buf.columns:
                self.buf[k] = np.nan
        new = pd.DataFrame([row])
        self.buf = pd.concat([self.buf, new], ignore_index=True).tail(STREAM_BUFFER_STEPS).reset_index(drop=True)
        self.step += 1

        validated = eng.validator.validate(self.buf)
        first_step = self.step - len(self.buf)
        calib_rows = int(np.clip(eng.calibration_steps - first_step, 0, len(self.buf)))
        res = eng.detector.analyze(validated, calibration_rows=calib_rows)
        last = res.iloc[-1]

        hybrid = int(last["hybrid_anomaly"])
        self.consecutive = self.consecutive + 1 if hybrid else 0
        alert = bool(hybrid and (self.consecutive >= ALERT_MIN_CONSECUTIVE
                                 or last["max_abs_zscore"] >= ALERT_Z_OVERRIDE))

        vitals = {c: (None if pd.isna(last[c]) else float(last[c])) for c in VITAL_COLUMNS}
        return to_jsonable({
            "step_index": self.step - 1,
            "timestamp": str(last["timestamp"]),
            "astronaut_id": str(last["astronaut_id"]),
            "model_version": eng.model_version,
            "vitals": vitals,
            "expected_now": {c: float(last[f"{c}_expected"]) for c in VITAL_COLUMNS},
            "zscores": {c: last[f"{c}_zscore"] for c in VITAL_COLUMNS},
            "activity_state": str(last["activity_state"]),
            "data_quality": {
                "is_corrupted": bool(last["is_corrupted_detected"] == 1),
                "corruption_reason": str(last["corruption_reason"]),
            },
            "intelligence": {
                "hybrid_anomaly": bool(hybrid),
                "stat_anomaly": bool(last["stat_anomaly"]),
                "ml_anomaly": bool(last["ml_anomaly"]),
                "trend_drift": bool(last["trend_drift_flag"]),
                "max_zscore": round(float(last["max_abs_zscore"]), 2),
                "anomaly_score": float(last["anomaly_score"]),
                "context": str(last["context"]),
                "consecutive_flagged": int(self.consecutive),
                "explanation": str(last["explanation"]),
            },
            "trigger_alert": alert,
            "trigger_n8n_alert": alert,          # alias kept for the existing n8n workflow
            "demo_only_scenario_label": str(last["scenario_label"]) if "scenario_label" in last.index
            and pd.notna(last["scenario_label"]) else None,
        })


# ---------------------------------------------------------- public helpers --
def analyze_health(data: pd.DataFrame, baseline: dict | None = None,
                   engine: HealthEngine | None = None, data_source: dict | None = None) -> dict:
    """Contract function agreed with the backend.

    * engine given      -> full hybrid analysis (statistical + trend + Isolation Forest)
    * baseline dict     -> rules-only analysis from a stored baseline (model_version 'rules-v2.0')
    * neither           -> baseline is fitted on the first 48 h of `data`, then hybrid analysis
    Returns the JSON-ready report (see docs/JSON_CONTRACT.md).
    """
    if engine is None:
        engine = HealthEngine.from_baseline(baseline) if baseline else HealthEngine().fit(data)
    return engine.analyze(data, data_source=data_source)["report"]


def evaluate_instant(profile: dict, reading: dict, timestamp: str | None = None) -> dict:
    """Score ONE reading against a stored baseline (stateless; no trend / ML context)."""
    base = PersonalBaselineModel.from_profile(profile)
    ts = pd.Series([pd.Timestamp(timestamp)]) if timestamp else None
    z, invalid, reasons = {}, [], []
    for col in VITAL_COLUMNS:
        val = reading.get(col)
        lo, hi = PLAUSIBILITY_BOUNDS[col]
        if val is None or not (lo <= float(val) <= hi):
            invalid.append(col)
            continue
        sl = np.array([1.0 if reading.get("activity_state") == "SLEEP" else 0.0])
        exp = float(base.expected(col, ts, sl)[0]) if ts is not None else float(profile["metrics"][col]["mean"])
        zc = (float(val) - exp) / base.sigma(col)
        z[col] = round(zc, 2)
        if abs(zc) >= 2.5:
            reasons.append(f"{col} {'elevated' if zc > 0 else 'depressed'} "
                           f"({val} vs expected {exp:.4g}, z={zc:+.1f})")
    max_z = max((abs(v) for v in z.values()), default=0.0)
    flagged = max_z >= Z_SCORE_THRESHOLD
    return {
        "astronaut_id": profile.get("astronaut_id"),
        "is_anomaly": bool(flagged),
        "severity": "HIGH_REVIEW_PRIORITY" if max_z >= 4.0 else ("MODERATE_DEVIATION" if flagged else "NOMINAL"),
        "max_abs_zscore": round(max_z, 2),
        "anomaly_score": round(min(1.0, max_z / Z_SATURATION), 3),
        "z_scores": z,
        "invalid_vitals": invalid,
        "time_of_day_baseline_applied": ts is not None,
        "explanation": " | ".join(reasons) if reasons else
        ("Some vitals were invalid and excluded." if invalid else "Nominal reading within personal baseline."),
        "trigger_alert": bool(flagged),
        "trigger_n8n_alert": bool(flagged),      # alias kept for the existing n8n workflow
        "note": "Single-reading check only: no trend, exercise context or Isolation Forest.",
    }
