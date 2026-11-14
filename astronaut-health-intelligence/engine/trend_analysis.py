"""
Higher-level analysis built on the per-row detector output:
  * extract_events  - group flagged rows into incidents (what n8n / the dashboard consume)
  * sleep_analysis  - nightly sleep duration vs. personal baseline (multi-day trend)
  * current_trends  - slope of the *residual* (value - expected) over the last 3 h
"""
import numpy as np
import pandas as pd

from engine.config import (
    VITAL_COLUMNS, SAMPLE_MINUTES, STEPS_PER_HOUR, EVENT_MERGE_GAP_STEPS,
    SUSTAINED_EVENT_MIN_MINUTES, HIGH_SCORE, ACTIVE_STATES, ALERT_MIN_CONSECUTIVE,
    STATUS_WINDOW_STEPS, TREND_REPORT_MIN_POINTS, SLEEP_STATE, SLEEP_MIN_NIGHT_HOURS,
    SLEEP_DEFICIT_HOURS, SLEEP_CONSECUTIVE_NIGHTS, SLEEP_MIN_STD_HOURS,
)


# ------------------------------------------------------------------ events --
def _group_flagged(df: pd.DataFrame) -> list[list[int]]:
    """Positions of hybrid-flagged rows, merged when separated by <= merge gap of
    *non-activity* rows (planned exercise masks vitals, so it must not split an event)."""
    flagged = np.flatnonzero(df["hybrid_anomaly"].to_numpy() == 1)
    if len(flagged) == 0:
        return []
    active = df["activity_state"].isin(ACTIVE_STATES).to_numpy()
    groups, cur = [], [flagged[0]]
    for prev, nxt in zip(flagged[:-1], flagged[1:]):
        gap_rows = np.arange(prev + 1, nxt)
        gap = int((~active[gap_rows]).sum()) if len(gap_rows) else 0
        if gap <= EVENT_MERGE_GAP_STEPS:
            cur.append(nxt)
        else:
            groups.append(cur)
            cur = [nxt]
    groups.append(cur)
    return groups


def new_aggregate() -> dict:
    """Running totals for one incident. Shared by the batch extractor and the live tracker,
    so both produce the same event by construction."""
    return {"rows": 0, "peak_z": 0.0, "peak_score": 0.0, "stat": False, "trend": False, "ml": False,
            "vitals": {c: {"n": 0, "sum_val": 0.0, "sum_exp": 0.0, "peak": 0.0} for c in VITAL_COLUMNS}}


def add_vital_sample(agg: dict, col: str, value, expected, z):
    v = agg["vitals"][col]
    v["n"] += 1
    v["sum_val"] += float(value)
    v["sum_exp"] += float(expected)
    if abs(z) > abs(v["peak"]):
        v["peak"] = float(z)


def event_id_for(astro: str, start, run: int = 1) -> str:
    """Stable id: the same incident always gets the same id, however often it is re-sent."""
    base = f"{astro}-EV-{pd.Timestamp(start):%Y%m%dT%H%M}"
    return base if run <= 1 else f"{base}-r{run}"


def event_from_aggregate(astro: str, start, end, agg: dict, profile: dict, run: int = 1,
                         demo_label: str | None = None) -> dict:
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    duration_min = int((end - start).total_seconds() / 60) + SAMPLE_MINUTES
    n_rows, peak_score, peak_z = agg["rows"], agg["peak_score"], agg["peak_z"]

    involved = []
    for col in VITAL_COLUMNS:
        v = agg["vitals"][col]
        if v["n"] == 0:
            continue
        sigma = profile["metrics"][col]["std"]
        obs_mean, exp_mean = v["sum_val"] / v["n"], v["sum_exp"] / v["n"]
        mean_z = (obs_mean - exp_mean) / sigma
        # "involved" = shifted on average over the whole event; one noise spike must not be blamed
        if abs(mean_z) >= 1.0:
            involved.append({
                "vital": col,
                "direction": "elevated" if mean_z > 0 else "depressed",
                "observed_mean": round(obs_mean, 3),
                "expected_mean": round(exp_mean, 3),
                "baseline_sigma": sigma,
                "mean_zscore": round(mean_z, 2),
                "peak_zscore": round(v["peak"], 2),
            })
    involved.sort(key=lambda d: -abs(d["mean_zscore"]))

    sustained = duration_min >= SUSTAINED_EVENT_MIN_MINUTES
    etype = "SUSTAINED_DRIFT" if sustained else "ACUTE_DEVIATION"
    review = bool(n_rows >= ALERT_MIN_CONSECUTIVE or peak_score >= HIGH_SCORE)
    if peak_score >= HIGH_SCORE or sustained:
        severity = "HIGH_REVIEW_PRIORITY"
    elif review:
        severity = "MODERATE_DEVIATION"
    else:
        severity = "LOW_DEVIATION"

    why = []
    if n_rows >= ALERT_MIN_CONSECUTIVE:
        why.append(f"{n_rows} flagged readings (>= {ALERT_MIN_CONSECUTIVE} required)")
    if peak_score >= HIGH_SCORE:
        why.append(f"peak deviation {peak_z:.1f} sigma (>= 4 required)")
    if sustained:
        why.append(f"deviation lasted {duration_min} min (>= {SUSTAINED_EVENT_MIN_MINUTES} = sustained)")
    review_reason = "; ".join(why) if why else "below review thresholds (noise-level, not sent for review)"

    names = ", ".join(f"{v['vital']} ({v['direction']}, mean z={v['mean_zscore']:+.1f})" for v in involved[:3]) \
        or "multivariate deviation"
    explanation = (
        f"{etype.replace('_', ' ').title()} from {start:%Y-%m-%d %H:%M} to {end:%H:%M} "
        f"({duration_min} min, {n_rows} flagged readings). Main contributors: {names}. "
        "Compared against the astronaut's own time-of-day baseline."
    )
    return {
        "event_id": event_id_for(astro, start, run),
        "astronaut_id": astro,
        "type": etype,
        "severity": severity,
        "needs_human_review": review,
        "review_reason": review_reason,
        "start": str(start),
        "end": str(end),
        "duration_minutes": duration_min,
        "flagged_readings": n_rows,
        "peak_zscore": round(peak_z, 2),
        "anomaly_score": round(peak_score, 3),
        "triggered_by": {"stat": agg["stat"], "trend": agg["trend"], "ml": agg["ml"]},
        "vitals_involved": involved,
        "explanation": explanation,
        "scenario_context_demo_only": demo_label,
    }


def extract_events(df: pd.DataFrame, baseline_profile: dict, run: int = 1) -> list[dict]:
    astro = str(df["astronaut_id"].iloc[0]) if len(df) else "UNKNOWN"
    events = []
    for pos in _group_flagged(df):
        seg = df.iloc[pos[0]:pos[-1] + 1]
        flagged = df.iloc[pos]
        agg = new_aggregate()
        agg["rows"] = len(flagged)
        agg["peak_z"] = float(flagged["max_abs_zscore"].max())
        agg["peak_score"] = float(flagged["anomaly_score"].max())
        agg["stat"] = bool(flagged["stat_anomaly"].any())
        agg["trend"] = bool(flagged["trend_drift_flag"].any())
        agg["ml"] = bool(flagged["ml_anomaly"].any())
        scored_rows = seg[seg["is_corrupted_detected"] == 0]
        for col in VITAL_COLUMNS:
            z = scored_rows[f"{col}_zscore"]
            sc = scored_rows[z.notna()]
            for val, exp, zz in zip(sc[col], sc[f"{col}_expected"], z[z.notna()]):
                add_vital_sample(agg, col, val, exp, zz)
        demo = str(seg["scenario_label"].mode().iloc[0]) if "scenario_label" in seg else None
        events.append(event_from_aggregate(astro, seg["timestamp"].iloc[0], seg["timestamp"].iloc[-1],
                                           agg, baseline_profile, run, demo))
    return events


# -------------------------------------------------------------------- sleep --
def sleep_analysis(df: pd.DataFrame, calibration_end: str | None,
                   baseline_hours: float | None = None) -> dict:
    """Nightly sleep duration (from activity_state) compared with the astronaut's
    own baseline nights (nights that finished inside the calibration window)."""
    if "activity_state" not in df or len(df) == 0:
        return {"status": "INSUFFICIENT_DATA", "nights": [], "baseline_hours": None,
                "note": "no activity_state column"}
    is_sleep = (df["activity_state"] == SLEEP_STATE).to_numpy()
    ts = pd.to_datetime(df["timestamp"]).to_numpy()
    runs, i, n = [], 0, len(df)
    while i < n:
        if is_sleep[i]:
            j = i
            while j + 1 < n and is_sleep[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1

    nights = []
    for a, b in runs:
        hours = (b - a + 1) * SAMPLE_MINUTES / 60.0
        in_progress = (b == n - 1)                       # night still going on
        if hours < SLEEP_MIN_NIGHT_HOURS or in_progress:
            continue
        nights.append({"night_start": str(pd.Timestamp(ts[a])), "wake": str(pd.Timestamp(ts[b])),
                       "hours": round(hours, 2)})

    cal_end = pd.to_datetime(calibration_end, utc=True) if calibration_end else None
    if baseline_hours is not None:                 # stored baseline (rules-only / backend use)
        base = [float(baseline_hours)]
    else:
        base = [x["hours"] for x in nights if cal_end is not None and pd.to_datetime(x["wake"], utc=True) <= cal_end]
    if not base:
        return {"status": "INSUFFICIENT_DATA", "nights": nights, "baseline_hours": None,
                "note": "no complete night inside the calibration window"}
    base_mean = float(np.mean(base))
    base_sd = max(float(np.std(base, ddof=1)) if len(base) > 1 else 0.0, SLEEP_MIN_STD_HOURS)

    post = []
    for x in nights:
        if cal_end is not None and pd.to_datetime(x["wake"], utc=True) <= cal_end:
            continue
        deficit = base_mean - x["hours"]
        x = dict(x)
        x["deficit_hours"] = round(deficit, 2)
        x["short_night"] = bool(deficit >= SLEEP_DEFICIT_HOURS)
        post.append(x)

    consec = 0
    for x in reversed(post):
        if x["short_night"]:
            consec += 1
        else:
            break
    if consec >= SLEEP_CONSECUTIVE_NIGHTS:
        status = "SLEEP_RESTRICTION_TREND"
    elif post and post[-1]["short_night"]:
        status = "SHORT_SLEEP_WATCH"
    else:
        status = "NOMINAL"
    return {
        "status": status,
        "baseline_hours": round(base_mean, 2),
        "baseline_nights": len(base),
        "baseline_sd_hours_floor": round(base_sd, 2),
        "short_night_rule": f">= {SLEEP_DEFICIT_HOURS} h below baseline; trend = {SLEEP_CONSECUTIVE_NIGHTS} consecutive short nights",
        "consecutive_short_nights": consec,
        "nights": post,
    }


# ------------------------------------------------------------------- trends --
def current_trends(df: pd.DataFrame, baseline_profile: dict) -> list[dict]:
    """Slope (per hour) of the residual value-expected over the last 3 h of valid,
    in-context readings. The threshold is 3x the analytic slope-noise for that many
    points, so a normal stream does not raise drift warnings by chance."""
    recent = df.tail(STATUS_WINDOW_STEPS)
    reports = []
    for col in VITAL_COLUMNS:
        resid = recent[col] - recent[f"{col}_expected"]
        ok = recent["is_corrupted_detected"] == 0
        if col in ("heart_rate_bpm", "hrv_ms", "resp_rate_bpm", "skin_temp_c"):
            ok &= ~recent["activity_state"].isin(ACTIVE_STATES)
        y = resid[ok].to_numpy(dtype=float)
        x = np.flatnonzero(ok.to_numpy()).astype(float)
        sigma = baseline_profile["metrics"][col]["std"]
        if len(y) < TREND_REPORT_MIN_POINTS:
            reports.append({"metric": col, "direction": "UNKNOWN", "slope_per_hour": None,
                            "slope_in_sigma_per_hour": None, "threshold_sigma_per_hour": None,
                            "status": "INSUFFICIENT_DATA"})
            continue
        slope = float(np.polyfit(x, y, 1)[0]) * STEPS_PER_HOUR
        n = len(y)
        noise_sd = sigma * np.sqrt(12.0 / (n * (n ** 2 - 1))) * STEPS_PER_HOUR
        thr = 3.0 * noise_sd
        s_sigma = slope / sigma
        if abs(slope) > thr:
            direction, status = ("INCREASING" if slope > 0 else "DECREASING"), "DRIFT_WARNING"
        else:
            direction, status = "STABLE", "NOMINAL"
        reports.append({
            "metric": col, "direction": direction,
            "slope_per_hour": round(slope, 3),
            "slope_in_sigma_per_hour": round(s_sigma, 3),
            "threshold_sigma_per_hour": round(thr / sigma, 3),
            "status": status,
        })
    return reports
