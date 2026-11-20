"""Presentation charts (PNG). Generated from real engine output, never hand-drawn."""
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from engine.config import BASELINE_WINDOW_STEPS, ACTIVE_STATES

LABELS = {
    "heart_rate_bpm": "Heart rate (bpm)",
    "hrv_ms": "HRV (ms)",
    "skin_temp_c": "Skin temperature (C)",
    "spo2_pct": "SpO2 (%)",
}


def baseline_vs_observed(result: dict, profile: dict, path: str, vitals=("heart_rate_bpm", "skin_temp_c", "spo2_pct")):
    df = result["df"]
    astro = str(df["astronaut_id"].iloc[0])
    t = pd.to_datetime(df["timestamp"])
    fig, axes = plt.subplots(len(vitals), 1, figsize=(14, 3.1 * len(vitals)), sharex=True)
    active = df["activity_state"].isin(ACTIVE_STATES).to_numpy()
    for ax, col in zip(np.atleast_1d(axes), vitals):
        sigma = profile["metrics"][col]["std"]
        exp = df[f"{col}_expected"]
        ax.axvspan(t.iloc[0], t.iloc[BASELINE_WINDOW_STEPS - 1], color="#bbbbbb", alpha=0.25, lw=0,
                   label="calibration (48 h)")
        ax.fill_between(t, exp - 2 * sigma, exp + 2 * sigma, color="#4c9be8", alpha=0.18,
                        label="personal baseline +/- 2 sigma")
        ax.plot(t, exp, color="#1f5fa8", lw=0.9, label="expected (time-of-day)")
        valid = df["is_corrupted_detected"] == 0
        ax.plot(t[valid], df.loc[valid, col], color="#222222", lw=0.6, alpha=0.8, label="observed")
        flagged = (df["hybrid_anomaly"] == 1) & valid
        ax.scatter(t[flagged], df.loc[flagged, col], s=9, color="#d62728", zorder=5, label="flagged")
        art = ~valid
        if art.any():
            y0 = ax.get_ylim()[0]
            ax.scatter(t[art], np.full(art.sum(), y0), marker="x", color="#ff7f0e", s=18, zorder=6,
                       label="sensor artifact (excluded)")
        for e in result["events"]:
            if e["severity"] != "LOW_DEVIATION":
                ax.axvspan(pd.Timestamp(e["start"]), pd.Timestamp(e["end"]), color="#d62728", alpha=0.10, lw=0)
        # planned exercise ticks
        starts = np.flatnonzero(np.diff(active.astype(int), prepend=0) == 1)
        for s in starts:
            ax.axvline(t.iloc[s], color="#2ca02c", lw=0.5, alpha=0.4)
        ax.set_ylabel(LABELS.get(col, col))
        ax.grid(alpha=0.2)
    handles, labels = np.atleast_1d(axes)[0].get_legend_handles_labels()
    np.atleast_1d(axes)[0].legend(handles, labels, loc="upper left", ncol=3, fontsize=7.5, framealpha=0.9)
    np.atleast_1d(axes)[0].set_title(
        f"{astro} - observed vs personal baseline (red = flagged, green lines = planned exercise start)", fontsize=11)
    plt.tight_layout()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, dpi=130)
    plt.close(fig)


def sleep_chart(sleep: dict, astro: str, path: str):
    nights = sleep.get("nights", [])
    base = sleep.get("baseline_hours")
    if not nights or base is None:
        return
    fig, ax = plt.subplots(figsize=(8, 3.6))
    x = [pd.Timestamp(n["night_start"]).strftime("%m-%d") for n in nights]
    h = [n["hours"] for n in nights]
    colors = ["#d62728" if n.get("short_night") else "#4c9be8" for n in nights]
    ax.bar(x, h, color=colors)
    ax.axhline(base, color="#222", ls="--", lw=1, label=f"personal baseline {base} h")
    ax.axhline(base - 1.0, color="#d62728", ls=":", lw=1, label="short-night rule (-1 h)")
    ax.set_ylabel("Sleep duration (h)")
    ax.set_title(f"{astro} - nightly sleep vs personal baseline ({sleep['status']})", fontsize=10)
    ax.legend(fontsize=8)
    ax.set_ylim(0, max(h + [base]) + 1.5)
    plt.tight_layout()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, dpi=130)
    plt.close(fig)


def ablation_chart(evaluation: dict, path: str):
    from engine.evaluation import pool
    names, fa, act = [], [], []
    for cname, c in evaluation["configs"].items():
        p = pool(c["per_astronaut"])["false_alarms"]
        names.append(cname.split(" ")[0] + "\n" + " ".join(cname.split(" ")[1:])[:30])
        fa.append(p["review_level_per_astronaut_day"])
        act.append(p["review_level_during_planned_activity"] / p["astronaut_days"])
    fig, ax = plt.subplots(figsize=(8.5, 4))
    x = np.arange(len(names))
    ax.bar(x - 0.18, fa, 0.36, label="review-level false alarms / astronaut-day", color="#d62728")
    ax.bar(x + 0.18, act, 0.36, label="...of which during planned exercise", color="#ff7f0e")
    ax.set_xticks(x)
    ax.set_xticklabels(names, fontsize=8)
    ax.set_title("Ablation: what each design change buys (7 astronauts pooled)", fontsize=10)
    ax.legend(fontsize=8)
    plt.tight_layout()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, dpi=130)
    plt.close(fig)
