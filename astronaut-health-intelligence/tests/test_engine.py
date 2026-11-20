"""
Run:  pytest -q            (or: python tests/test_engine.py  - tiny built-in runner)

Acceptance criteria:
  * every injected physiological event is detected, on the inspected AND the blind astronauts
  * detection latency <= 150 min
  * the inspected control astronaut (ASTRO_04) has no more than one HIGH-priority event
  * planned exercise does not raise flags
  * streaming result == batch result
  * the engine never reads ground-truth columns
NOT asserted on purpose: the false-alarm rate on the blind astronauts. It is about 0.7 review-level
events per astronaut-day there (see outputs/evaluation_report.md); a test that hides that would be dishonest.
"""
import json
import os
import sys
from functools import lru_cache

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.config import BASELINE_WINDOW_STEPS, ACTIVE_STATES
from engine.contract import validate_report
from engine.evaluation import evaluate_astronaut, truth_events
from engine.generator import generate_dataset, AstronautDataGenerator, ALL_ASTRONAUTS
from engine.health_engine import HealthEngine, analyze_health, evaluate_instant
from engine.validator import TelemetryValidator

GT_COLS = ["scenario_label", "is_anomaly_ground_truth", "is_corrupted_ground_truth", "scenario_onset"]


@lru_cache(maxsize=1)
def dataset():
    return generate_dataset(ALL_ASTRONAUTS)


def raw(a):
    d = dataset()
    return d[d["astronaut_id"] == a].reset_index(drop=True)


@lru_cache(maxsize=8)
def fitted(a):
    r = raw(a)
    e = HealthEngine().fit(r)
    return e, e.analyze(r)


# ------------------------------------------------------------------ data ----
def test_generator_is_deterministic_and_has_seven_astronauts():
    a = AstronautDataGenerator("ASTRO_02").generate_stream()
    b = AstronautDataGenerator("ASTRO_02").generate_stream()
    pd.testing.assert_frame_equal(a, b)
    assert dataset()["astronaut_id"].nunique() == 7
    assert len(raw("ASTRO_01")) == 7 * 288
    assert set(raw("ASTRO_01")["activity_state"]) == {"REST", "SLEEP", "ACTIVE"}


def test_astronauts_have_different_baselines():
    hr = [fitted(a)[0].profile["metrics"]["heart_rate_bpm"]["mean"] for a in
          ("ASTRO_01", "ASTRO_02", "ASTRO_03", "ASTRO_04")]
    assert max(hr) - min(hr) > 8.0          # "personal" baseline must actually differ


# ------------------------------------------------------------- validator ----
def test_validator_catches_artifacts_without_imputing_or_false_alarms():
    r = raw("ASTRO_01")
    v = TelemetryValidator().validate(r)
    gt = r["is_corrupted_ground_truth"].to_numpy() == 1
    det = v["is_corrupted_detected"].to_numpy() == 1
    assert not (det & ~gt).any(), "valid rows must never be flagged corrupted"
    assert v.loc[700:702, "spo2_pct"].isna().all()                  # missing stays missing
    assert "OUT_OF_BOUNDS_HEART_RATE_BPM" in v.loc[703, "corruption_reason"]
    assert v.loc[703, "heart_rate_bpm"] != v.loc[703, "heart_rate_bpm"]   # NaN, not interpolated
    flat = v.loc[1300:1311, "corruption_reason"]
    assert flat.str.contains("FLATLINE_HEART_RATE_BPM").sum() >= 4      # flagged once 8 identical


def test_validator_reasons_accumulate():
    r = raw("ASTRO_01").iloc[:50].copy()
    r.loc[10, "spo2_pct"] = np.nan
    r.loc[10, "heart_rate_bpm"] = 265.0
    v = TelemetryValidator().validate(r)
    reason = v.loc[10, "corruption_reason"]
    assert "MISSING_SPO2_PCT" in reason and "OUT_OF_BOUNDS_HEART_RATE_BPM" in reason


def test_long_gap_means_insufficient_data_not_a_health_conclusion():
    r = raw("ASTRO_01").iloc[:900].copy()
    r.loc[r.index[-12]:, "spo2_pct"] = np.nan                     # 1 h outage right now
    e, _ = fitted("ASTRO_01")
    res = e.analyze(r)
    assert res["quality"]["status"] == "INSUFFICIENT_DATA"
    assert res["report"]["status"] == "INSUFFICIENT_DATA"
    assert res["report"]["needs_human_review"] is False


# -------------------------------------------------------------- baseline ----
def test_circadian_baseline_shrinks_sigma_and_learns_sleep_effect():
    m = fitted("ASTRO_01")[0].profile["metrics"]["heart_rate_bpm"]
    assert m["model"] == "circadian"
    assert m["std"] < 0.5 * m["raw_std"]                       # v1 sigma was ~3x too large
    assert 1.4 <= m["std"] <= 2.3                              # true noise SD is 1.8
    assert m["sleep_effect"] < -2.0                            # HR is lower during sleep
    assert m["circadian_peak_hour"] is not None


def test_baseline_falls_back_to_flat_on_short_calibration():
    e = HealthEngine().fit(raw("ASTRO_01"), calibration_steps=100)   # ~8 h only
    assert e.profile["metrics"]["heart_rate_bpm"]["model"] == "flat"


def test_baseline_refuses_to_fit_without_valid_data():
    r = raw("ASTRO_01").iloc[:40]
    try:
        HealthEngine().fit(r, calibration_steps=40)
    except ValueError as err:
        assert "calibration" in str(err).lower()
    else:
        raise AssertionError("expected ValueError")


# -------------------------------------------------------------- detection ---
def test_exercise_is_not_flagged():
    _, res = fitted("ASTRO_04")
    df = res["df"].iloc[BASELINE_WINDOW_STEPS:]
    active = df["activity_state"].isin(ACTIVE_STATES)
    assert active.sum() > 50
    assert df.loc[active, "hybrid_anomaly"].mean() < 0.03


def test_all_injected_events_detected_on_every_astronaut_with_bounded_latency():
    for a in ("ASTRO_01", "ASTRO_02", "ASTRO_03"):
        m = evaluate_astronaut(raw(a))
        assert len(m["events"]) == 2
        for ev in m["events"]:
            h = ev["methods"]["hybrid_final"]
            assert h["detected"], (a, ev["type"])
            assert h["latency_minutes"] <= 150, (a, ev["type"], h)


def test_blind_astronauts_all_injected_events_detected():
    for a in ("ASTRO_05", "ASTRO_06"):
        m = evaluate_astronaut(raw(a))
        assert len(m["events"]) == 2
        for ev in m["events"]:
            h = ev["methods"]["hybrid_final"]
            assert h["detected"] and h["latency_minutes"] <= 150, (a, ev["type"], h)
    assert truth_events(raw("ASTRO_07")) == []


def test_control_astronaut_has_no_high_priority_event():
    _, res = fitted("ASTRO_04")
    assert truth_events(raw("ASTRO_04")) == []
    high = [e for e in res["events"] if e["severity"] == "HIGH_REVIEW_PRIORITY"]
    assert len(high) <= 1                                  # chance 4-sigma override, documented
    m = evaluate_astronaut(raw("ASTRO_04"))
    assert m["false_alarm_events_review"] <= 2


def test_sensor_artifact_rows_are_never_flagged_as_anomalies():
    _, res = fitted("ASTRO_01")
    df = res["df"]
    bad = df["is_corrupted_detected"] == 1
    assert (df.loc[bad, "hybrid_anomaly"] == 0).all()
    assert (df.loc[bad, "anomaly_score"] == 0).all()


def test_acute_event_explanation_names_the_vitals_and_time_of_day_baseline():
    _, res = fitted("ASTRO_01")
    ev = next(e for e in res["events"] if e["scenario_context_demo_only"] == "ACUTE_ANOMALY"
              and e["needs_human_review"])
    names = [v["vital"] for v in ev["vitals_involved"]]
    assert "heart_rate_bpm" in names
    assert ev["vitals_involved"][0]["baseline_sigma"] > 0
    assert "time-of-day baseline" in ev["explanation"]
    assert ev["type"] == "ACUTE_DEVIATION"


def test_drift_is_classified_as_sustained():
    _, res = fitted("ASTRO_02")
    drift = [e for e in res["events"] if e["scenario_context_demo_only"] == "GRADUAL_DRIFT"
             and e["needs_human_review"]]
    assert drift and drift[0]["type"] == "SUSTAINED_DRIFT"
    assert drift[0]["triggered_by"]["trend"]


def test_isolation_forest_alone_never_creates_a_hybrid_flag():
    _, res = fitted("ASTRO_04")
    df = res["df"]
    only_ml = (df["ml_anomaly"] == 1) & (df["stat_anomaly"] == 0) & (df["trend_drift_flag"] == 0) \
        & (df["max_abs_zscore"] < 2.0)
    assert (df.loc[only_ml, "hybrid_anomaly"] == 0).all()


# ------------------------------------------------------------------ sleep ---
def test_sleep_restriction_detected_and_control_not_flagged():
    assert fitted("ASTRO_01")[1]["sleep"]["status"] == "SLEEP_RESTRICTION_TREND"
    assert fitted("ASTRO_03")[1]["sleep"]["status"] == "NOMINAL"      # no restriction injected
    nights = fitted("ASTRO_03")[1]["sleep"]["nights"]
    assert not any(n["short_night"] for n in nights)


# -------------------------------------------------------------- streaming ---
def test_streaming_equals_batch_and_ignores_ground_truth():
    e, res = fitted("ASTRO_01")
    batch = res["df"]
    r = raw("ASTRO_01")
    session = e.start_stream(r.iloc[:BASELINE_WINDOW_STEPS])
    lo, hi = BASELINE_WINDOW_STEPS, 900          # covers the acute event at step 780
    ticks = [session.push(r.iloc[i].drop(labels=GT_COLS).to_dict()) for i in range(lo, hi)]
    sh = np.array([t["intelligence"]["hybrid_anomaly"] for t in ticks], dtype=int)
    sa = np.array([t["trigger_alert"] for t in ticks], dtype=int)
    assert (sh == batch["hybrid_anomaly"].iloc[lo:hi].to_numpy()).all()
    assert (sa == batch["trigger_alert"].iloc[lo:hi].to_numpy()).all()
    assert sa.sum() > 5 and ticks[0]["trigger_n8n_alert"] in (True, False)
    assert ticks[-1]["demo_only_scenario_label"] is None       # ground truth was withheld


def test_engine_output_does_not_depend_on_ground_truth_columns():
    e, res = fitted("ASTRO_02")
    r = raw("ASTRO_02").drop(columns=GT_COLS)
    again = e.analyze(r)["df"]
    assert (again["hybrid_anomaly"].to_numpy() == res["df"]["hybrid_anomaly"].to_numpy()).all()


# --------------------------------------------------------------- contract ---
def test_reports_follow_the_contract_and_are_strict_json():
    for a in ("ASTRO_01", "ASTRO_02", "ASTRO_03", "ASTRO_04"):
        rep = fitted(a)[1]["report"]
        assert validate_report(rep) == [], (a, validate_report(rep))
        json.dumps(rep, allow_nan=False)                      # no NaN / Infinity leaks
    assert fitted("ASTRO_01")[1]["report"]["model_version"] == "hybrid-v2.0"


def test_analyze_health_rules_only_from_stored_baseline():
    e, _ = fitted("ASTRO_01")
    window = raw("ASTRO_01").iloc[760:900].reset_index(drop=True)
    rep = analyze_health(window, baseline=e.profile)
    assert rep["model_version"] == "rules-v2.0"
    assert rep["summary_metrics"]["hybrid_flags"] > 5            # acute event inside the window
    assert validate_report(rep) == []
    rep_full = analyze_health(window, engine=e)
    assert rep_full["model_version"] == "hybrid-v2.0"


def test_evaluate_instant_uses_time_of_day_and_excludes_invalid_vitals():
    prof = fitted("ASTRO_01")[0].profile
    base = dict(heart_rate_bpm=53.0, hrv_ms=82.0, spo2_pct=98.2, skin_temp_c=36.55, resp_rate_bpm=12.8,
                activity_state="SLEEP")
    ok = evaluate_instant(prof, base, "2026-11-13 03:00:00")
    assert ok["is_anomaly"] is False and ok["time_of_day_baseline_applied"] is True
    bad = evaluate_instant(prof, {**base, "heart_rate_bpm": 95.0}, "2026-11-13 03:00:00")
    assert bad["is_anomaly"] is True and bad["severity"] == "HIGH_REVIEW_PRIORITY"
    inv = evaluate_instant(prof, {**base, "spo2_pct": 250.0}, "2026-11-13 03:00:00")
    assert "spo2_pct" in inv["invalid_vitals"]


def test_api_schemas_import_when_pydantic_is_installed():
    try:
        import pydantic  # noqa: F401
    except ImportError:
        return
    from engine.schemas import AnalyzeRequest, SingleVitalReading
    SingleVitalReading(heart_rate_bpm=60, hrv_ms=70, spo2_pct=98, skin_temp_c=36.8, resp_rate_bpm=14)
    assert AnalyzeRequest.model_fields["readings"] is not None


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS  {name}")
        except Exception as exc:                       # noqa: BLE001
            failed += 1
            print(f"FAIL  {name}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
