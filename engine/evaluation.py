"""
Honest evaluation.

Protocol (so the numbers can be defended):
  * ASTRO_01          DEVELOPMENT: the design was iterated while looking at it.
  * ASTRO_02..04      INSPECTED: different baselines/events, but their output WAS looked at while
                      the design was being finished (e.g. the sleep-state term was added after
                      seeing false alarms on ASTRO_04). They are NOT blind.
  * ASTRO_05..07      BLIND: generated after the design was frozen (new seeds, new event positions
                      and magnitudes, one weak-event astronaut, one pure control). Run once;
                      nothing was tuned afterwards. This is the split to quote.
  * Row-level P/R/F1 are reported, but the main metrics are EVENT-level:
        - event recall            (was each injected event detected?)
        - detection latency       (minutes from true onset to first flag)
        - review-level false alarms per astronaut-day
  * Ablation: v1-style flat baseline -> + circadian/sleep baseline -> + exercise context.

Limitation (say it out loud): the data are synthetic and written by the same people
who wrote the detector. This shows the engine behaves as designed; it is NOT evidence
of clinical validity.
"""
import json
import os

import numpy as np
import pandas as pd
from sklearn.metrics import precision_score, recall_score, f1_score

from engine.config import SAMPLE_MINUTES, BASELINE_WINDOW_STEPS, ACTIVE_STATES
from engine.generator import generate_dataset, SCENARIOS, START_TIMESTAMP, ALL_ASTRONAUTS
from engine.health_engine import HealthEngine

DEV = ["ASTRO_01"]
INSPECTED = ["ASTRO_02", "ASTRO_03", "ASTRO_04"]
BLIND = ["ASTRO_05", "ASTRO_06", "ASTRO_07"]
METHODS = {
    "statistical_zscore": "stat_anomaly",
    "isolation_forest_alone": "ml_anomaly",
    "trend_detector": "trend_drift_flag",
    "hybrid_final": "hybrid_anomaly",
    "hybrid_alert_gated": "trigger_alert",   # hybrid + persistence rule (what actually raises an alert)
}
TAIL_ALLOWANCE_STEPS = 18      # a 1 h trend window keeps flagging ~1 h after an event ends


# -------------------------------------------------------------- ground truth --
def _naive(value) -> "pd.Timestamp":
    """Timestamp without timezone: event times may carry +00:00 while the dataset clock is naive."""
    ts = pd.Timestamp(value)
    return ts.tz_localize(None) if ts.tzinfo is not None else ts


def truth_events(df: pd.DataFrame) -> list[dict]:
    out = []
    for label in ("ACUTE_ANOMALY", "GRADUAL_DRIFT"):
        idx = np.flatnonzero((df["scenario_label"] == label).to_numpy())
        if len(idx):
            out.append({"type": label, "onset": int(idx[0]), "end": int(idx[-1])})
    return out


def _row_counts(y, p):
    tp = int(((y == 1) & (p == 1)).sum()); fp = int(((y == 0) & (p == 1)).sum())
    fn = int(((y == 1) & (p == 0)).sum())
    return tp, fp, fn


def _prf(tp, fp, fn):
    pr = tp / (tp + fp) if tp + fp else 0.0
    rc = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * pr * rc / (pr + rc) if pr + rc else 0.0
    return round(pr, 3), round(rc, 3), round(f1, 3)


# ----------------------------------------------------------- one astronaut ---
def evaluate_astronaut(raw: pd.DataFrame, **engine_kwargs) -> dict:
    engine = HealthEngine(**engine_kwargs).fit(raw)
    result = engine.analyze(raw)
    df, events = result["df"], result["events"]
    post = df.iloc[BASELINE_WINDOW_STEPS:]
    truths = truth_events(df)
    # The engine reports UTC-aware times, the generated dataset clock is naive: compare on one clock.
    ts_naive = df["timestamp"].dt.tz_localize(None) if df["timestamp"].dt.tz is not None else df["timestamp"]

    # Grey zone (excluded from row-level scoring, not counted as TP or FP):
    #   - the early part of a drift ramp before the row-truth starts (detecting it is *good*)
    #   - the ~1 h after an event ends (the 1 h rolling window cannot forget instantly)
    grey = np.zeros(len(df), dtype=bool)
    gt = df["is_anomaly_ground_truth"].to_numpy()
    for t in truths:
        first_true = t["onset"] + int(np.argmax(gt[t["onset"]:t["end"] + 1] == 1))
        grey[t["onset"]:first_true] = True
        grey[t["end"] + 1:t["end"] + 1 + TAIL_ALLOWANCE_STEPS] = True
    keep = ~grey[BASELINE_WINDOW_STEPS:]
    y = post["is_anomaly_ground_truth"].to_numpy()[keep]

    rows = {name: _row_counts(y, post[col].to_numpy()[keep]) for name, col in METHODS.items()}

    ev_res = []
    for t in truths:
        lo, hi = t["onset"], min(len(df) - 1, t["end"] + TAIL_ALLOWANCE_STEPS)
        per_method = {}
        for name, col in METHODS.items():
            fl = np.flatnonzero(df[col].to_numpy()[lo:hi + 1] == 1)
            fl = fl[(fl + lo) >= BASELINE_WINDOW_STEPS]
            per_method[name] = {
                "detected": bool(len(fl)),
                "latency_minutes": int(fl[0] * SAMPLE_MINUTES) if len(fl) else None,
            }
        ev_res.append({"type": t["type"], "onset_step": t["onset"], "methods": per_method})

    # false alarms: engine events that do not overlap any true window
    windows = [(ts_naive.iloc[t["onset"]],
                ts_naive.iloc[min(len(df) - 1, t["end"] + TAIL_ALLOWANCE_STEPS)]) for t in truths]
    # sensor artifacts are labelled separately: flags on them are impossible by construction
    fa_all = fa_review = fa_review_during_activity = 0
    fa_details = []
    for e in events:
        s, en = _naive(e["start"]), _naive(e["end"])
        if any(s <= w1 and en >= w0 for w0, w1 in windows):
            continue
        fa_all += 1
        if e["needs_human_review"]:
            fa_review += 1
            seg = df[(ts_naive >= s) & (ts_naive <= en)]
            if seg["activity_state"].isin(ACTIVE_STATES).mean() > 0.5:
                fa_review_during_activity += 1
            fa_details.append({"event_id": e["event_id"], "start": e["start"],
                               "rows": e["flagged_readings"], "peak_z": e["peak_zscore"]})
    days = len(post) * SAMPLE_MINUTES / 1440.0

    # data-quality detection vs injected corruption (row level)
    gt_c = df["is_corrupted_ground_truth"].to_numpy()
    det_c = df["is_corrupted_detected"].to_numpy()
    dq = {"injected_rows": int(gt_c.sum()),
          "detected_rows": int(((gt_c == 1) & (det_c == 1)).sum()),
          "false_corrupt_rows": int(((gt_c == 0) & (det_c == 1)).sum())}

    # sleep: restricted nights vs flagged short nights
    sched = SCENARIOS.get(str(raw["astronaut_id"].iloc[0]), {}).get("sleep_nights", {})
    start = pd.Timestamp(START_TIMESTAMP).normalize()
    flagged_nights, evaluated_nights = set(), set()
    for n in result["sleep"].get("nights", []):
        k = (_naive(n["night_start"]).normalize() - start).days
        evaluated_nights.add(k)
        if n.get("short_night"):
            flagged_nights.add(k)
    truth_nights = {k for k in sched if k in evaluated_nights}
    sleep = {"truth_short_nights": sorted(truth_nights), "flagged_short_nights": sorted(flagged_nights),
             "evaluated_nights": sorted(evaluated_nights)}

    return {"rows": rows, "events": ev_res, "false_alarm_events_all": fa_all,
            "false_alarm_events_review": fa_review,
            "false_alarm_review_during_activity": fa_review_during_activity,
            "false_alarm_details": fa_details, "astronaut_days": round(days, 2),
            "data_quality": dq, "sleep": sleep, "sleep_status": result["sleep"]["status"],
            "hr_sigma": result["report"]["baseline"]["metrics"]["heart_rate_bpm"]["std"],
            "hr_raw_sigma": result["report"]["baseline"]["metrics"]["heart_rate_bpm"]["raw_std"]}


# ----------------------------------------------------------------- pooling ---
def pool(per_astro: dict) -> dict:
    rows = {}
    for m in METHODS:
        tp = sum(a["rows"][m][0] for a in per_astro.values())
        fp = sum(a["rows"][m][1] for a in per_astro.values())
        fn = sum(a["rows"][m][2] for a in per_astro.values())
        p, r, f = _prf(tp, fp, fn)
        rows[m] = {"precision": p, "recall": r, "f1": f, "tp": tp, "fp": fp, "fn": fn}

    ev = {m: {"truth_events": 0, "detected": 0, "latencies": []} for m in METHODS}
    for a in per_astro.values():
        for e in a["events"]:
            for m in METHODS:
                ev[m]["truth_events"] += 1
                if e["methods"][m]["detected"]:
                    ev[m]["detected"] += 1
                    ev[m]["latencies"].append(e["methods"][m]["latency_minutes"])
    event = {}
    for m, v in ev.items():
        lat = v["latencies"]
        event[m] = {"event_recall": f"{v['detected']}/{v['truth_events']}",
                    "median_latency_min": float(np.median(lat)) if lat else None,
                    "max_latency_min": int(max(lat)) if lat else None}
    days = sum(a["astronaut_days"] for a in per_astro.values())
    fa_rev = sum(a["false_alarm_events_review"] for a in per_astro.values())
    fa_all = sum(a["false_alarm_events_all"] for a in per_astro.values())
    fa_act = sum(a["false_alarm_review_during_activity"] for a in per_astro.values())

    inj = sum(a["data_quality"]["injected_rows"] for a in per_astro.values())
    det = sum(a["data_quality"]["detected_rows"] for a in per_astro.values())
    fcor = sum(a["data_quality"]["false_corrupt_rows"] for a in per_astro.values())

    t_n = sum(len(a["sleep"]["truth_short_nights"]) for a in per_astro.values())
    hit = sum(len(set(a["sleep"]["truth_short_nights"]) & set(a["sleep"]["flagged_short_nights"]))
              for a in per_astro.values())
    fl = sum(len(a["sleep"]["flagged_short_nights"]) for a in per_astro.values())
    return {
        "row_level": rows, "event_level": event,
        "false_alarms": {"review_level_events": fa_rev, "all_events_incl_low": fa_all,
                         "review_level_during_planned_activity": fa_act,
                         "astronaut_days": round(days, 2),
                         "review_level_per_astronaut_day": round(fa_rev / days, 3) if days else None},
        "data_quality": {"injected_corrupted_rows": inj, "detected": det, "false_corrupt_rows": fcor,
                         "row_recall": round(det / inj, 3) if inj else None,
                         "note": "A stuck sensor is only declared after 8 identical readings, "
                                 "so its first 7 readings are (by design) not flagged."},
        "sleep": {"truth_short_nights": t_n, "detected": hit, "flagged_total": fl},
    }


CONFIGS = {
    "A_v1_style (flat baseline, no context)": dict(use_circadian=False, use_context=False),
    "B_+circadian/sleep baseline": dict(use_circadian=True, use_context=False),
    "C_final (+exercise context)": dict(use_circadian=True, use_context=True),
}


def run_evaluation(data: pd.DataFrame | None = None) -> dict:
    data = generate_dataset(ALL_ASTRONAUTS) if data is None else data
    out = {"protocol": __doc__.strip(), "configs": {}}
    for cname, kw in CONFIGS.items():
        res = {}
        for a in DEV + INSPECTED + BLIND:
            raw = data[data["astronaut_id"] == a].reset_index(drop=True)
            res[a] = evaluate_astronaut(raw, **kw)
        out["configs"][cname] = {
            "per_astronaut": res,
            "development": pool({a: res[a] for a in DEV}),
            "inspected": pool({a: res[a] for a in INSPECTED}),
            "blind": pool({a: res[a] for a in BLIND}),
        }
    return out


# ------------------------------------------------------------------- report --
def to_markdown(ev: dict) -> str:
    final = ev["configs"]["C_final (+exercise context)"]
    L = ["# Evaluation Report - Health Intelligence Engine", "",
         "> Synthetic data written by the same team as the detector: this shows the engine behaves as "
         "designed, it is **not** clinical validation.", "",
         "## Protocol", "",
         "- `ASTRO_01` = development astronaut (design iterated while looking at it).",
         "- `ASTRO_02-04` = **inspected**: different baselines/events, but their output was looked at while the design "
         "was being finished (the sleep-state term was added after seeing false alarms on `ASTRO_04`). Not blind.",
         "- `ASTRO_05-07` = **blind**: generated after the design was frozen, new seeds/positions/magnitudes (one weak-event "
         "astronaut, one pure control). Run once, nothing tuned afterwards. **Quote this split.**",
         "- Calibration = first 48 h; evaluation on the remaining ~5 days.",
         "- Main metrics are event-level (recall, latency, false alarms/day). Row-level numbers are shown for completeness; "
         "rows in a grey zone (early drift ramp before 25 % build-up, and the 1 h after an event) are excluded from row-level "
         "scoring so that early detection is not punished.", ""]
    for split, title in (("blind", "BLIND astronauts (ASTRO_05-07)"), ("inspected", "Inspected astronauts (ASTRO_02-04)"),
                         ("development", "Development astronaut (ASTRO_01)")):
        d = final[split]
        L += [f"## Final model - {title}", "", "| Method | Row precision | Row recall | Row F1 | Event recall | Median latency (min) | Max latency (min) |",
              "|---|---|---|---|---|---|---|"]
        for m in METHODS:
            r, e = d["row_level"][m], d["event_level"][m]
            L.append(f"| {m} | {r['precision']} | {r['recall']} | {r['f1']} | {e['event_recall']} | "
                     f"{e['median_latency_min']} | {e['max_latency_min']} |")
        fa = d["false_alarms"]
        L += ["", f"- Review-level false-alarm events: **{fa['review_level_events']}** over {fa['astronaut_days']} astronaut-days "
                  f"(**{fa['review_level_per_astronaut_day']}/day**); all events incl. single-reading LOW: {fa['all_events_incl_low']}.",
              f"- Data quality: injected corrupted rows {d['data_quality']['injected_corrupted_rows']}, detected "
              f"{d['data_quality']['detected']} (row recall {d['data_quality']['row_recall']}), false corrupt rows "
              f"{d['data_quality']['false_corrupt_rows']}. {d['data_quality']['note']}",
              f"- Sleep restriction: {d['sleep']['detected']}/{d['sleep']['truth_short_nights']} restricted nights flagged "
              f"({d['sleep']['flagged_total']} nights flagged in total).", ""]
    L += ["## Ablation (all 7 astronauts pooled, hybrid detector)", "",
          "| Configuration | HR sigma (bpm, mean) | Event recall | Median latency (min) | Review-level false alarms | per astronaut-day | of which during planned exercise |",
          "|---|---|---|---|---|---|---|"]
    for cname, c in ev["configs"].items():
        pooled = pool(c["per_astronaut"])
        e, fa = pooled["event_level"]["hybrid_final"], pooled["false_alarms"]
        sig = np.mean([a["hr_sigma"] for a in c["per_astronaut"].values()])
        L.append(f"| {cname} | {sig:.2f} | {e['event_recall']} | {e['median_latency_min']} | "
                 f"{fa['review_level_events']} | {fa['review_level_per_astronaut_day']} | {fa['review_level_during_planned_activity']} |")
    L += ["", "> Config A's median latency is not comparable: with a flat baseline it already raises about one review-level "
          "false alarm per astronaut-day on normal data, so early 'detections' can be coincidences.", "",
          "## Honest reading", "",
          "- No single detector wins everywhere. The trend detector has the highest row precision but is the slowest "
          "(it needs about an hour of evidence). The single-reading z-score and Isolation Forest react faster but fire on isolated "
          "noise. The hybrid is as fast as the fastest single detector and covers both acute and drifting events, "
          "but its row-level precision is the lowest because it is a union of detectors.",
          "- That row-level cost is contained by the persistence rule: isolated flags become LOW events and do not alert. "
          "`hybrid_alert_gated` is the row-level view of what actually raises an alert: much higher precision, at the price of "
          "~20 min extra latency (it waits for persistence).",
          "- Isolation Forest never alarms alone in the hybrid: its alarm budget is set on calibration data "
          "(1 % of calibration rows), which is not a disease prevalence.",
          "- **False-alarm rate is the weak point.** Blind split: about 0.7 review-level events per astronaut-day, inspected split "
          "0.2 (those astronauts were simply luckier), pooled over all 7 astronauts about 0.4. They are chance runs of >= 3 consecutive "
          "flagged readings (15 min) or a single 4-sigma value; with 5 vitals and autocorrelated noise this happens. "
          "Raising `ALERT_MIN_CONSECUTIVE` or `ALERT_Z_OVERRIDE` in `engine/config.py` would reduce them at the cost of latency, "
          "but that change has NOT been validated on a new blind set, so it was not applied.",
          "- A moderate sleep restriction (about 0.75 h below baseline) is below the 1 h rule and is not flagged; that is a "
          "design choice, not a bug.",
          "- Not evaluated: real astronaut data, microgravity-specific physiology changes, sensor drift over months, "
          "missing-data patterns of a real telemetry link."]
    return "\n".join(L)


def main(out_dir: str = "outputs"):
    os.makedirs(out_dir, exist_ok=True)
    ev = run_evaluation()
    with open(os.path.join(out_dir, "evaluation_report.json"), "w", encoding="utf-8") as f:
        json.dump(ev, f, indent=2, ensure_ascii=False, default=str)
    md = to_markdown(ev)
    with open(os.path.join(out_dir, "evaluation_report.md"), "w", encoding="utf-8") as f:
        f.write(md)
    print(md)
    return ev


if __name__ == "__main__":
    main()
