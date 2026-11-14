"""
End-to-end run:   python main_pipeline.py

Writes
  data/raw/synthetic_astronaut_telemetry.csv     4 astronauts x 7 days, 5-min samples
  data/test_scenarios.csv                        what was injected where (ground truth)
  data/processed/analyzed_telemetry.csv          per-reading engine output
  data/processed/engine_output.json              full contract report per astronaut
  outputs/sample_analysis.json                   sample contract (mid-drift snapshot, REVIEW_REQUIRED)
  outputs/reports/<ASTRO>.json                   final-state report per astronaut
  outputs/charts/*.png                           baseline-vs-observed, sleep, ablation
  outputs/evaluation_report.{json,md}            held-out evaluation + ablation
"""
import json
import os

import pandas as pd

from engine.contract import validate_report
from engine.evaluation import run_evaluation, to_markdown
from engine.generator import generate_dataset, DEFAULT_ASTRONAUTS, ALL_ASTRONAUTS
from engine.health_engine import HealthEngine, to_jsonable

RAW_PATH = "data/raw/synthetic_astronaut_telemetry.csv"
DATA_SOURCE = {"type": "synthetic_simulator", "is_real_astronaut_data": False,
               "engine_reads_ground_truth_columns": False}


def ensure_dirs():
    for d in ("data/raw", "data/processed", "outputs/charts", "outputs/reports"):
        os.makedirs(d, exist_ok=True)


def load_or_generate_raw() -> pd.DataFrame:
    if os.path.exists(RAW_PATH):
        return pd.read_csv(RAW_PATH, parse_dates=["timestamp"])
    ensure_dirs()
    df = generate_dataset()
    df.to_csv(RAW_PATH, index=False)
    return df


def write_test_scenarios(data: pd.DataFrame):
    rows = []
    for a in data["astronaut_id"].unique():
        d = data[data["astronaut_id"] == a].reset_index(drop=True)
        for label in ("ACUTE_ANOMALY", "GRADUAL_DRIFT", "SENSOR_ARTIFACT"):
            idx = d.index[d["scenario_label"] == label]
            if len(idx):
                rows.append({"astronaut_id": a, "scenario": label, "first_step": int(idx[0]),
                             "last_step": int(idx[-1]), "start_timestamp": str(d.loc[idx[0], "timestamp"]),
                             "rows": int(len(idx))})
    pd.DataFrame(rows).to_csv("data/test_scenarios.csv", index=False)


def write_integration_samples(data: pd.DataFrame):
    """Real samples for the Backend / n8n / Dashboard teams, produced by running the live system."""
    from engine.live import LiveSystem
    os.makedirs("outputs/samples", exist_ok=True)
    live = LiveSystem(data, ["ASTRO_01"], start_step=760, events_log_path=None)
    raw_row = live.get("ASTRO_01").raw.iloc[760].to_dict()
    ticks = []
    for _ in range(45):                      # steps 760-804: crosses the acute event at step 780
        ticks.append(live.step_once("ASTRO_01"))
    feed = live.feed_since(0)
    first = next(e for e in feed["events"] if e["event_type"] == "HEALTH_REVIEW_REQUIRED")
    gt = ["scenario_label", "is_anomaly_ground_truth", "is_corrupted_ground_truth", "scenario_onset"]
    sample_reading = {k: v for k, v in raw_row.items() if k not in gt}
    out = {
        "raw_telemetry_reading.json": sample_reading,
        "live_tick.json": ticks[22],
        "health_event_review_required.json": first,
        "health_event_feed.json": feed,
        "live_health_report.json": live.report("ASTRO_01"),
        "astronauts_summary.json": live.summary(),
    }
    for name, obj in out.items():
        with open(f"outputs/samples/{name}", "w", encoding="utf-8") as f:
            json.dump(to_jsonable(obj), f, indent=2, ensure_ascii=False)


def run_health_intelligence_pipeline(make_charts: bool = True, run_eval: bool = True) -> dict:
    ensure_dirs()
    data = generate_dataset()
    data.to_csv(RAW_PATH, index=False)
    write_test_scenarios(data)

    reports, frames, results = {}, [], {}
    for a in DEFAULT_ASTRONAUTS:
        raw = data[data["astronaut_id"] == a].reset_index(drop=True)
        engine = HealthEngine().fit(raw)
        res = engine.analyze(raw, data_source=DATA_SOURCE)
        problems = validate_report(res["report"])
        assert not problems, f"contract violation for {a}: {problems}"
        reports[a], results[a] = res["report"], (engine, res)
        frames.append(res["df"])
        with open(f"outputs/reports/{a}.json", "w", encoding="utf-8") as f:
            json.dump(res["report"], f, indent=2, ensure_ascii=False)
        r = res["report"]
        print(f"{a}: status={r['status']:<16} score={r['anomaly_score']:.2f} events={r['summary_metrics']['events_total']} "
              f"review={r['summary_metrics']['events_needing_review']} sleep={r['sleep']['status']} "
              f"model={r['model_version']}")

    keep = ["astronaut_id", "timestamp", "activity_state", "heart_rate_bpm", "hrv_ms", "spo2_pct",
            "skin_temp_c", "resp_rate_bpm", "is_corrupted_detected", "corruption_reason",
            "heart_rate_bpm_expected", "heart_rate_bpm_zscore", "max_abs_zscore", "stat_anomaly",
            "ml_anomaly", "trend_drift_flag", "hybrid_anomaly", "anomaly_score", "trigger_alert",
            "context", "explanation", "scenario_label"]
    pd.concat(frames)[keep].to_csv("data/processed/analyzed_telemetry.csv", index=False)
    with open("data/processed/engine_output.json", "w", encoding="utf-8") as f:
        json.dump({"astronauts": reports}, f, indent=2, ensure_ascii=False)

    # Sample contract: ASTRO_01 snapshot in the middle of the drift episode
    raw1 = data[data["astronaut_id"] == "ASTRO_01"].reset_index(drop=True)
    engine1 = results["ASTRO_01"][0]
    snap = engine1.analyze(raw1.iloc[:1000], data_source=DATA_SOURCE)["report"]
    with open("outputs/sample_analysis.json", "w", encoding="utf-8") as f:
        json.dump(snap, f, indent=2, ensure_ascii=False)
    print(f"sample_analysis.json snapshot: status={snap['status']} score={snap['anomaly_score']}")

    evaluation = None
    if run_eval:
        evaluation = run_evaluation(generate_dataset(ALL_ASTRONAUTS))   # incl. the 3 blind astronauts
        with open("outputs/evaluation_report.json", "w", encoding="utf-8") as f:
            json.dump(evaluation, f, indent=2, ensure_ascii=False, default=str)
        with open("outputs/evaluation_report.md", "w", encoding="utf-8") as f:
            f.write(to_markdown(evaluation))

    if make_charts:
        from engine import charts
        for a, (engine, res) in results.items():
            charts.baseline_vs_observed(res, engine.profile, f"outputs/charts/{a}_baseline_vs_observed.png")
            charts.sleep_chart(res["sleep"], a, f"outputs/charts/{a}_sleep.png")
        if evaluation:
            charts.ablation_chart(evaluation, "outputs/charts/ablation.png")
    write_integration_samples(generate_dataset(DEFAULT_ASTRONAUTS))
    print("Integration samples written to outputs/samples/")
    print("Pipeline complete.")
    return {"reports": reports, "evaluation": evaluation}


if __name__ == "__main__":
    run_health_intelligence_pipeline()
