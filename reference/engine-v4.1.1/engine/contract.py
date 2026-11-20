"""
Pure-Python check of the JSON contract (no pydantic needed).
Used by the pipeline (fail fast before writing files) and by the tests.
The human-readable description is in docs/JSON_CONTRACT.md.
"""
from engine.config import VITAL_COLUMNS

STATUSES = {"NOMINAL", "MONITOR_CLOSELY", "REVIEW_REQUIRED", "INSUFFICIENT_DATA"}
SEVERITIES = {"NONE", "LOW_DEVIATION", "MODERATE_DEVIATION", "HIGH_REVIEW_PRIORITY"}

TOP_LEVEL = {
    "schema_version": str, "astronaut_id": str, "generated_at": str, "model_version": str,
    "disclaimer": str, "status": str, "needs_human_review": bool, "anomaly_score": (int, float),
    "anomaly_score_definition": str, "reason": str, "data_source": dict, "data_quality": dict,
    "baseline": dict, "observed": dict, "trend_analysis": list, "sleep": dict,
    "events": list, "summary_metrics": dict, "latest_reading_at": str, "severity": str,
    "key_findings": list, "latest_vitals": dict,
}  # "active_event" is also required but may be null

EVENT_KEYS = {"event_id", "astronaut_id", "type", "severity", "needs_human_review", "start", "end",
              "duration_minutes", "flagged_readings", "peak_zscore", "anomaly_score", "triggered_by",
              "vitals_involved", "explanation", "review_reason"}


def validate_report(report: dict) -> list[str]:
    errs = []
    for k, t in TOP_LEVEL.items():
        if k not in report:
            errs.append(f"missing key: {k}")
        elif not isinstance(report[k], t):
            errs.append(f"wrong type for {k}: {type(report[k]).__name__}")
    for k in ("active_event", "latest_event_id"):
        if k not in report:
            errs.append(f"missing key: {k}")
    if errs:
        return errs
    if report["status"] not in STATUSES:
        errs.append(f"invalid status: {report['status']}")
    if report["severity"] not in SEVERITIES:
        errs.append(f"invalid severity: {report['severity']}")
    if not 0.0 <= report["anomaly_score"] <= 1.0:
        errs.append("anomaly_score outside 0..1")
    if report["needs_human_review"] != (report["status"] == "REVIEW_REQUIRED"):
        errs.append("needs_human_review inconsistent with status")
    for v in VITAL_COLUMNS:
        if v not in report["baseline"]["metrics"]:
            errs.append(f"baseline missing {v}")
        if v not in report["observed"]["vitals"]:
            errs.append(f"observed missing {v}")
    for e in report["events"] + ([report["active_event"]] if report["active_event"] else []):
        missing = EVENT_KEYS - set(e)
        if missing:
            errs.append(f"event {e.get('event_id')} missing {sorted(missing)}")
    if report["data_source"].get("is_real_astronaut_data") is None:
        errs.append("data_source.is_real_astronaut_data must be stated")
    return errs
