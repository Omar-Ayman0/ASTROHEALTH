"""
Real-dataset adapter (v2.1).

Turns an arbitrary telemetry table (CSV / DataFrame) into the engine's input schema WITHOUT
changing the engine or the JSON contract:

    timestamp, astronaut_id, activity_state, heart_rate_bpm, hrv_ms, spo2_pct, skin_temp_c, resp_rate_bpm

Driven by a small mapping dict (or JSON file), e.g. data/mapping.example.json:

    {
      "columns": {"time": "timestamp", "id": "astronaut_id", "HR": "heart_rate_bpm", ...},
      "units":   {"skin_temp_c": "F", "spo2_pct": "fraction"},
      "hrv_metric": "SDNN",
      "timezone": "UTC",
      "resample_minutes": 5,
      "nightly_sleep": {"file": "sleep.csv", "id": "subject", "date": "night", "hours": "hours",
                        "start": null, "end": null, "default_bedtime": "23:00"}
    }

Rules (so the output can be defended):
  * NO imputation. Resampling averages the readings inside a bin; an empty bin stays NaN and the
    validator flags it (MISSING_*), exactly as for any other gap.
  * HRV metric must be declared. RMSSD and SDNN are different quantities; we do not convert between
    them (it would be invented precision). The metric is only recorded and warned about.
  * `activity_state` absent -> "UNKNOWN" (treated as rest: exercise will NOT be masked). A warning says so.
  * Nightly sleep given as ONE number per night is not epoch data. It is expanded into SLEEP rows
    starting at the night's start time (or default_bedtime) and lasting `hours`. This is a
    RECONSTRUCTION and is reported in `warnings`; real start/end times are always preferred.
  * Ground-truth columns (is_anomaly_ground_truth ...) are never required; absent -> 0.
"""
from __future__ import annotations

import json
import re

import numpy as np
import pandas as pd

from engine.config import VITAL_COLUMNS, SAMPLE_MINUTES, HRV_ACCEPTED_METRICS, HRV_METRIC

ENGINE_COLUMNS = ["timestamp", "astronaut_id", "activity_state"] + VITAL_COLUMNS
_GT = {"scenario_label": "UNLABELLED", "is_anomaly_ground_truth": 0,
       "is_corrupted_ground_truth": 0, "scenario_onset": 0}

# column-name guesses used only when the mapping does not name a column (always reported)
_GUESS = {
    "timestamp": r"^(time|timestamp|datetime|date_time|recorded_at|ts)$",
    "astronaut_id": r"^(astronaut_?id|subject(_?id)?|participant(_?id)?|crew(_?id)?|user(_?id)?|id)$",
    "activity_state": r"^(activity(_?state)?|state|phase)$",
    "heart_rate_bpm": r"^(heart_?rate(_?bpm)?|hr(_?bpm)?|pulse)$",
    "hrv_ms": r"^(hrv(_?ms)?|rmssd|sdnn)$",
    "spo2_pct": r"^(spo2(_?pct)?|oxygen_?saturation|blood_?oxygen)$",
    "skin_temp_c": r"^(skin_?temp(_?c)?|temperature|temp(_?c)?)$",
    "resp_rate_bpm": r"^(resp(iratory)?_?rate(_?bpm)?|rr|breathing_?rate)$",
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(s).strip().lower()).strip("_")


def load_mapping(path_or_dict) -> dict:
    if isinstance(path_or_dict, dict):
        return path_or_dict
    with open(path_or_dict, encoding="utf-8") as f:
        return json.load(f)


def _resolve_columns(df: pd.DataFrame, mapping: dict, warnings: list) -> dict:
    """target engine column -> source column in df."""
    src_by_norm = {_norm(c): c for c in df.columns}
    explicit = {}
    for src, target in (mapping.get("columns") or {}).items():
        if src not in df.columns and _norm(src) in src_by_norm:
            src = src_by_norm[_norm(src)]
        if src not in df.columns:
            raise KeyError(f"mapping names column {src!r} but the file has: {list(df.columns)}")
        explicit[target] = src
    out = dict(explicit)
    for target, rx in _GUESS.items():
        if target in out:
            continue
        hits = [c for n, c in src_by_norm.items() if re.match(rx, n)]
        if len(hits) == 1:
            out[target] = hits[0]
            warnings.append(f"column for {target!r} was GUESSED from the name {hits[0]!r}; confirm it in the mapping file")
    return out


def _convert_units(s: pd.Series, col: str, unit: str | None, warnings: list) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    u = (unit or "").strip().lower()
    if col == "skin_temp_c":
        if u in ("f", "degf", "fahrenheit"):
            s = (s - 32.0) * 5.0 / 9.0
        elif u in ("k", "kelvin"):
            s = s - 273.15
        elif u in ("", "c", "degc", "celsius"):
            pass
        else:
            raise ValueError(f"unknown temperature unit {unit!r}")
        warnings.append("skin_temp_c is treated as PERIPHERAL skin temperature. If the source is core/oral/tympanic "
                        "temperature, the plausibility bound (28-42 C) still works but the meaning differs: say so in the report.")
    elif col == "spo2_pct":
        if u == "fraction" or (u == "" and s.dropna().between(0, 1.0).all() and s.notna().any()):
            s = s * 100.0
            if u == "":
                warnings.append("spo2 looked like a 0-1 fraction and was multiplied by 100; set units.spo2_pct explicitly")
    elif col == "hrv_ms":
        if u in ("s", "sec", "seconds"):
            s = s * 1000.0
    return s


def adapt(source, mapping: dict | str, *, return_report: bool = True):
    """
    source  : path to CSV or a DataFrame
    mapping : dict or path to a JSON mapping file
    returns : (engine_df, report)   report = {"warnings": [...], "columns_used": {...}, "per_astronaut": {...}}
    """
    mapping = load_mapping(mapping)
    warnings: list[str] = []
    raw = pd.read_csv(source) if isinstance(source, str) else source.copy()
    cols = _resolve_columns(raw, mapping, warnings)

    missing = [c for c in ("timestamp", *VITAL_COLUMNS) if c not in cols]
    if missing:
        raise KeyError(f"cannot build engine input, no source column for: {missing}")

    out = pd.DataFrame()
    ts = pd.to_datetime(raw[cols["timestamp"]], errors="coerce", utc=True)
    if ts.isna().all():
        raise ValueError("timestamps could not be parsed")
    tz = mapping.get("timezone")
    ts = ts.dt.tz_convert(tz) if tz else ts
    out["timestamp"] = ts.dt.tz_localize(None)          # the engine works on naive wall-clock time
    if tz:
        warnings.append(f"timestamps converted to {tz} and made timezone-naive (the 24 h rhythm uses local clock time)")
    else:
        warnings.append("no timezone in mapping: timestamps are treated as UTC. The circadian baseline uses hour of day, "
                        "so set `timezone` to the crew's schedule timezone if it is not UTC")

    out["astronaut_id"] = raw[cols["astronaut_id"]].astype(str) if "astronaut_id" in cols else "ASTRO_01"
    if "astronaut_id" not in cols:
        warnings.append("no astronaut id column: all rows assigned to ASTRO_01")

    if "activity_state" in cols:
        out["activity_state"] = raw[cols["activity_state"]].astype(str).str.upper().str.strip()
        amap = {k.upper(): v.upper() for k, v in (mapping.get("activity_map") or {}).items()}
        out["activity_state"] = out["activity_state"].replace(amap)
        bad = sorted(set(out["activity_state"]) - {"REST", "SLEEP", "ACTIVE", "UNKNOWN"})
        if bad:
            warnings.append(f"activity values {bad} are not REST/SLEEP/ACTIVE/UNKNOWN: add `activity_map` "
                            "(e.g. {'RUNNING':'ACTIVE','ASLEEP':'SLEEP'}); until then they are treated as rest")
    else:
        out["activity_state"] = "UNKNOWN"
        warnings.append("no activity_state column: exercise is NOT masked, so planned exercise can raise false alarms, "
                        "and sleep must come from `nightly_sleep`")

    units = mapping.get("units") or {}
    for c in VITAL_COLUMNS:
        out[c] = _convert_units(raw[cols[c]], c, units.get(c), warnings)

    metric = str(mapping.get("hrv_metric", "")).upper()
    if not metric:
        warnings.append(f"hrv_metric not declared: assuming {HRV_METRIC}. RMSSD and SDNN are NOT interchangeable; "
                        "declare it, and never mix them inside one astronaut's stream")
        metric = HRV_METRIC
    elif metric not in HRV_ACCEPTED_METRICS:
        warnings.append(f"hrv_metric {metric!r} is not one of {HRV_ACCEPTED_METRICS}; values are used as-is, personal "
                        "baselines still work but do not compare with published numbers")

    out = out.dropna(subset=["timestamp"]).sort_values(["astronaut_id", "timestamp"])

    # ---- resample to the engine's 5-minute grid (mean within bin, no imputation)
    step = int(mapping.get("resample_minutes", SAMPLE_MINUTES))
    if step != SAMPLE_MINUTES:
        warnings.append(f"resample_minutes={step} but the engine thresholds assume {SAMPLE_MINUTES}-minute samples "
                        "(flatline = 8 readings, trend window = 12): rates in `engine/config.py` must be re-derived")
    frames = []
    for aid, g in out.groupby("astronaut_id", sort=True):
        g = g.set_index("timestamp")
        agg = {c: "mean" for c in VITAL_COLUMNS}
        agg["activity_state"] = lambda x: x.mode().iat[0] if len(x.mode()) else "UNKNOWN"
        r = g.resample(f"{step}min").agg(agg)
        r["activity_state"] = r["activity_state"].fillna("UNKNOWN")
        r["astronaut_id"] = aid
        frames.append(r.reset_index())
    eng = pd.concat(frames, ignore_index=True)

    # ---- nightly sleep (one value per night) -> SLEEP rows, clearly reported
    ns = mapping.get("nightly_sleep")
    if ns:
        eng = _apply_nightly_sleep(eng, ns, warnings)

    for k, v in _GT.items():
        eng[k] = v
    eng = eng[ENGINE_COLUMNS + list(_GT)].sort_values(["astronaut_id", "timestamp"]).reset_index(drop=True)

    per = {}
    for aid, g in eng.groupby("astronaut_id"):
        hours = (g["timestamp"].max() - g["timestamp"].min()).total_seconds() / 3600
        per[aid] = {"rows": int(len(g)), "hours": round(hours, 1),
                    "missing_fraction": round(float(g[VITAL_COLUMNS].isna().any(axis=1).mean()), 3)}
        if hours < 48:
            warnings.append(f"{aid}: only {hours:.0f} h of data; baseline calibration needs 48 h "
                            "(BASELINE_WINDOW_STEPS), shorter data falls back to a flat baseline or INSUFFICIENT_DATA")
    report = {"warnings": warnings, "columns_used": cols, "hrv_metric": metric,
              "per_astronaut": per, "is_real_astronaut_data": bool(mapping.get("is_real_astronaut_data", False))}
    return (eng, report) if return_report else eng


def _apply_nightly_sleep(eng: pd.DataFrame, ns: dict, warnings: list) -> pd.DataFrame:
    sl = pd.read_csv(ns["file"]) if "file" in ns else ns["frame"]
    idc, datec, hc = ns.get("id"), ns.get("date"), ns.get("hours")
    sc, ec = ns.get("start"), ns.get("end")
    bed = pd.to_timedelta(str(ns.get("default_bedtime", "23:00")) + ":00")
    eng = eng.copy()
    used_default = False
    for _, row in sl.iterrows():
        aid = str(row[idc]) if idc else eng["astronaut_id"].iloc[0]
        if sc and ec and pd.notna(row.get(sc)) and pd.notna(row.get(ec)):
            start, end = pd.to_datetime(row[sc]), pd.to_datetime(row[ec])
        else:
            used_default = True
            start = pd.to_datetime(row[datec]).normalize() + bed
            end = start + pd.to_timedelta(float(row[hc]), unit="h")
        m = (eng["astronaut_id"] == aid) & (eng["timestamp"] >= start) & (eng["timestamp"] < end)
        eng.loc[m, "activity_state"] = "SLEEP"
    if used_default:
        warnings.append(f"nightly sleep had no start/end times: SLEEP rows were RECONSTRUCTED from the night's date + "
                        f"default_bedtime ({ns.get('default_bedtime', '23:00')}) + duration. Duration is real, timing is assumed; "
                        "the sleep-state baseline for HR/HRV may be biased if the true bedtime differs")
    return eng


def write_example_mapping(path: str):
    ex = {
        "columns": {"time": "timestamp", "subject": "astronaut_id", "HR": "heart_rate_bpm", "HRV": "hrv_ms",
                    "SpO2": "spo2_pct", "SkinTemp": "skin_temp_c", "RR": "resp_rate_bpm", "activity": "activity_state"},
        "units": {"skin_temp_c": "C", "spo2_pct": "percent", "hrv_ms": "ms"},
        "hrv_metric": "RMSSD",
        "timezone": "UTC",
        "resample_minutes": 5,
        "activity_map": {"EXERCISE": "ACTIVE", "ASLEEP": "SLEEP", "AWAKE": "REST"},
        "nightly_sleep": {"file": "sleep.csv", "id": "subject", "date": "night", "hours": "hours",
                          "start": None, "end": None, "default_bedtime": "23:00"},
        "is_real_astronaut_data": False,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(ex, f, indent=2)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Convert a telemetry CSV to the engine input schema")
    ap.add_argument("csv"); ap.add_argument("mapping"); ap.add_argument("out")
    a = ap.parse_args()
    df, rep = adapt(a.csv, a.mapping)
    df.to_csv(a.out, index=False)
    print(json.dumps(rep, indent=2, default=str))
