"""
Synthetic telemetry generator (research prototype - NOT real astronaut data).

What is simulated, and why (see docs/RESEARCH.md):
  * 24 h circadian rhythm in HR / HRV / temperature / respiration
  * a fixed daily schedule: sleep (23:00 + night-specific duration) and one
    exercise session (10:00) - exercise is the classic *confounder* for a
    heart-rate anomaly detector
  * autocorrelated (AR(1)) sensor noise, so "sustained" detection is tested fairly
  * 4 astronauts with different baselines and different scenario schedules:
        ASTRO_01  development astronaut (thresholds were chosen looking at it)
        ASTRO_02  held-out: acute event + drift + sleep restriction
        ASTRO_03  held-out: weaker events + stuck sensor, no sleep restriction
        ASTRO_04  held-out control: no physiological anomaly (only a sensor glitch)

Ground truth columns (never read by the engine):
  scenario_label, is_anomaly_ground_truth, is_corrupted_ground_truth, scenario_onset
"""
import os

import numpy as np
import pandas as pd

from engine.config import SAMPLE_MINUTES

START_TIMESTAMP = "2026-11-11 12:00:00"   # noon start => first 48 h contain 2 full nights
DEFAULT_DAYS = 7

PROFILES = {
    "ASTRO_01": dict(hr=62.0, hrv=68.0, spo2=98.2, temp=36.80, resp=14.0, phase=0.0, seed=42),
    "ASTRO_02": dict(hr=57.0, hrv=76.0, spo2=98.6, temp=36.60, resp=12.8, phase=1.5, seed=7),
    "ASTRO_03": dict(hr=71.0, hrv=54.0, spo2=97.8, temp=36.95, resp=15.4, phase=-1.0, seed=21),
    "ASTRO_04": dict(hr=65.0, hrv=62.0, spo2=98.0, temp=36.75, resp=14.6, phase=0.5, seed=99),
}
DEFAULT_ASTRONAUTS = list(PROFILES)      # the 4 used by the demo / API

# Astronauts generated AFTER the design was frozen. Nobody looked at their results
# while building the engine; they are used for the one-shot "blind" evaluation.
PROFILES.update({
    "ASTRO_05": dict(hr=60.0, hrv=72.0, spo2=98.4, temp=36.70, resp=13.5, phase=2.0, seed=5),
    "ASTRO_06": dict(hr=68.0, hrv=58.0, spo2=97.9, temp=36.90, resp=15.0, phase=-2.0, seed=61),
    "ASTRO_07": dict(hr=64.0, hrv=66.0, spo2=98.1, temp=36.80, resp=14.2, phase=0.0, seed=777),
})
BLIND_ASTRONAUTS = ["ASTRO_05", "ASTRO_06", "ASTRO_07"]
ALL_ASTRONAUTS = list(PROFILES)

# Scenario schedules. Indices are 5-minute steps from START_TIMESTAMP.
# calibration = steps 0..575, so every scenario sits after it.
SCENARIOS = {
    "ASTRO_01": dict(
        artifact=dict(start=700, spo2_nan=3, hr_spike_at=703, temp_zero=(704, 705)),
        acute=dict(start=780, n=11, hr=+38.0, hrv=-28.0, spo2=-4.5),
        drift=dict(start=900, n=91, temp=+1.4, hr=+22.0, hrv=-20.0),
        flatline=dict(start=1300, n=12, col="heart_rate_bpm"),
        sleep_nights={4: 6.2, 5: 5.6, 6: 5.2},
    ),
    "ASTRO_02": dict(
        artifact=dict(start=1250, spo2_nan=4, hr_spike_at=None, temp_zero=None),
        acute=dict(start=1500, n=13, hr=+30.0, hrv=-22.0, spo2=-3.5),
        drift=dict(start=1700, n=100, temp=+1.0, hr=+15.0, hrv=-15.0),
        flatline=None,
        sleep_nights={3: 6.4, 4: 5.8, 5: 5.5},
    ),
    "ASTRO_03": dict(
        artifact=dict(start=650, spo2_nan=2, hr_spike_at=652, temp_zero=None),
        acute=dict(start=1200, n=9, hr=+26.0, hrv=-18.0, spo2=-3.0),
        drift=dict(start=800, n=80, temp=+0.8, hr=+12.0, hrv=-12.0),
        flatline=dict(start=1900, n=12, col="resp_rate_bpm"),
        sleep_nights={},
    ),
    "ASTRO_04": dict(
        artifact=dict(start=1100, spo2_nan=3, hr_spike_at=None, temp_zero=None),
        acute=None, drift=None, flatline=None, sleep_nights={},
    ),
}

SCENARIOS.update({
    "ASTRO_05": dict(
        artifact=dict(start=900, spo2_nan=5, hr_spike_at=906, temp_zero=None),
        acute=dict(start=1100, n=12, hr=+28.0, hrv=-20.0, spo2=-3.2),
        drift=dict(start=1450, n=96, temp=+0.9, hr=+13.0, hrv=-13.0),
        flatline=dict(start=1800, n=10, col="hrv_ms"),
        sleep_nights={3: 6.3, 4: 5.7, 5: 5.4},
    ),
    "ASTRO_06": dict(
        artifact=dict(start=1600, spo2_nan=2, hr_spike_at=None, temp_zero=(1605, 1606)),
        acute=dict(start=640, n=8, hr=+24.0, hrv=-16.0, spo2=-2.8),
        drift=dict(start=1000, n=70, temp=+0.7, hr=+10.0, hrv=-10.0),
        flatline=None,
        sleep_nights={},
    ),
    "ASTRO_07": dict(
        artifact=dict(start=1000, spo2_nan=3, hr_spike_at=None, temp_zero=None),
        acute=None, drift=None, flatline=None, sleep_nights={},
    ),
})

DRIFT_LABEL_FRACTION = 0.25   # row-level truth starts once 25 % of the ramp has built up


class AstronautDataGenerator:
    def __init__(self, astronaut_id: str = "ASTRO_01", seed: int | None = None):
        self.astronaut_id = astronaut_id
        self.profile = PROFILES.get(astronaut_id, PROFILES["ASTRO_01"])
        self.scenarios = SCENARIOS.get(astronaut_id, {})
        self.rng = np.random.default_rng(self.profile["seed"] if seed is None else seed)

    # ------------------------------------------------------------ helpers --
    def _ar1(self, n: int, sd: float, phi: float = 0.5) -> np.ndarray:
        """AR(1) noise with the requested marginal SD."""
        w = self.rng.normal(0.0, 1.0, n)
        e = np.zeros(n)
        e[0] = w[0]
        scale = np.sqrt(1.0 - phi ** 2)
        for i in range(1, n):
            e[i] = phi * e[i - 1] + scale * w[i]
        return e * sd

    def _schedule(self, n: int, freq: int):
        """Return (hours-since-day0-midnight, sleep mask, exercise bump in [0,1])."""
        t_clock = 12.0 + np.arange(n) * freq / 60.0
        n_days = int(np.ceil(t_clock[-1] / 24.0)) + 1
        durations = {k: 7.4 for k in range(n_days + 1)}
        # small natural night-to-night variation (deterministic per astronaut)
        jitter = np.random.default_rng(self.profile["seed"] + 1).normal(0, 0.15, n_days + 1)
        for k in durations:
            durations[k] = round(float(np.clip(7.4 + jitter[k], 6.9, 7.9)) * 12) / 12
        for k, d in self.scenarios.get("sleep_nights", {}).items():
            durations[k] = d

        sleep = np.zeros(n, dtype=bool)
        for k in range(n_days + 1):
            bed = 24.0 * k + 23.0
            sleep |= (t_clock >= bed) & (t_clock < bed + durations[k])

        bump = np.zeros(n)
        steps_per_hour = 60 // freq
        for k in range(n_days + 1):
            start = 24.0 * k + 10.0
            idx0 = int(round((start - 12.0) * steps_per_hour))
            ex_steps, rec_steps = steps_per_hour, steps_per_hour // 2   # 60 min + 30 min recovery
            for j in range(ex_steps):
                i = idx0 + j
                if 0 <= i < n:
                    bump[i] = min(1.0, (j + 1) / 3.0)
            for j in range(rec_steps):
                i = idx0 + ex_steps + j
                if 0 <= i < n:
                    bump[i] = 1.0 - (j + 1) / (rec_steps + 1)
        return t_clock, sleep, bump

    # ------------------------------------------------------------- stream --
    def generate_stream(self, duration_hours: int = DEFAULT_DAYS * 24,
                        freq_minutes: int = SAMPLE_MINUTES) -> pd.DataFrame:
        p = self.profile
        n = (duration_hours * 60) // freq_minutes
        ts = pd.date_range(start=START_TIMESTAMP, periods=n, freq=f"{freq_minutes}min")
        t_clock, sleep, bump = self._schedule(n, freq_minutes)
        circ = np.sin(2 * np.pi * (t_clock - 9.0 - p["phase"]) / 24.0)   # peak mid-afternoon

        hr = p["hr"] + 5.0 * circ - 4.0 * sleep + 30.0 * bump + self._ar1(n, 1.8)
        hrv = p["hrv"] - 6.0 * circ + 8.0 * sleep - 20.0 * bump + self._ar1(n, 3.0)
        spo2 = np.clip(p["spo2"] - 0.3 * bump + self._ar1(n, 0.4, 0.3), 95.5, 100.0)
        temp = p["temp"] + 0.25 * circ + 0.5 * bump + self._ar1(n, 0.08)
        resp = p["resp"] + 1.2 * circ + 7.0 * bump + self._ar1(n, 0.5)

        state = np.where(sleep, "SLEEP", np.where(bump > 0, "ACTIVE", "REST"))
        df = pd.DataFrame({
            "timestamp": ts,
            "astronaut_id": self.astronaut_id,
            "activity_state": state,
            "heart_rate_bpm": np.round(hr, 1),
            "hrv_ms": np.round(hrv, 1),
            "spo2_pct": np.round(spo2, 1),
            "skin_temp_c": np.round(temp, 2),
            "resp_rate_bpm": np.round(resp, 1),
            "scenario_label": "NORMAL",
            "is_anomaly_ground_truth": 0,
            "is_corrupted_ground_truth": 0,
            "scenario_onset": 0,
        })
        return self._inject_scenarios(df)

    # ---------------------------------------------------------- scenarios --
    def _inject_scenarios(self, df: pd.DataFrame) -> pd.DataFrame:
        sc = self.scenarios
        col = df.columns.get_loc

        a = sc.get("artifact")
        if a:
            s = a["start"]
            df.iloc[s:s + a["spo2_nan"], col("spo2_pct")] = np.nan
            rows = list(range(s, s + a["spo2_nan"]))
            if a.get("hr_spike_at") is not None:
                df.iloc[a["hr_spike_at"], col("heart_rate_bpm")] = 265.0
                rows.append(a["hr_spike_at"])
            if a.get("temp_zero"):
                lo, hi = a["temp_zero"]
                df.iloc[lo:hi + 1, col("skin_temp_c")] = 0.0
                rows += list(range(lo, hi + 1))
            self._label(df, rows, "SENSOR_ARTIFACT", anomaly=0, corrupted=1, onset=s)

        f = sc.get("flatline")
        if f:
            s, n = f["start"], f["n"]
            df.iloc[s:s + n, col(f["col"])] = df.iloc[s, col(f["col"])]
            self._label(df, range(s, s + n), "SENSOR_ARTIFACT", anomaly=0, corrupted=1, onset=s)

        ac = sc.get("acute")
        if ac:
            s, n = ac["start"], ac["n"]
            df.iloc[s:s + n, col("heart_rate_bpm")] += ac["hr"]
            df.iloc[s:s + n, col("hrv_ms")] += ac["hrv"]
            df.iloc[s:s + n, col("spo2_pct")] += ac["spo2"]
            self._label(df, range(s, s + n), "ACUTE_ANOMALY", anomaly=1, corrupted=0, onset=s)

        dr = sc.get("drift")
        if dr:
            s, n = dr["start"], dr["n"]
            ramp = np.linspace(0.0, 1.0, n)
            df.iloc[s:s + n, col("skin_temp_c")] += dr["temp"] * ramp
            df.iloc[s:s + n, col("heart_rate_bpm")] += dr["hr"] * ramp
            df.iloc[s:s + n, col("hrv_ms")] -= abs(dr["hrv"]) * ramp
            first_true = s + int(DRIFT_LABEL_FRACTION * n)
            self._label(df, range(s, s + n), "GRADUAL_DRIFT", anomaly=0, corrupted=0, onset=s)
            df.iloc[first_true:s + n, col("is_anomaly_ground_truth")] = 1

        # keep decimals tidy after additions
        df["heart_rate_bpm"] = df["heart_rate_bpm"].round(1)
        df["hrv_ms"] = df["hrv_ms"].round(1)
        df["spo2_pct"] = df["spo2_pct"].round(1)
        df["skin_temp_c"] = df["skin_temp_c"].round(2)
        return df

    @staticmethod
    def _label(df, rows, label, anomaly, corrupted, onset):
        rows = list(rows)
        df.iloc[rows, df.columns.get_loc("scenario_label")] = label
        df.iloc[rows, df.columns.get_loc("is_anomaly_ground_truth")] = anomaly
        df.iloc[rows, df.columns.get_loc("is_corrupted_ground_truth")] = corrupted
        df.iloc[onset, df.columns.get_loc("scenario_onset")] = 1


def generate_dataset(astronaut_ids=None, duration_hours: int = DEFAULT_DAYS * 24) -> pd.DataFrame:
    ids = astronaut_ids or DEFAULT_ASTRONAUTS
    frames = [AstronautDataGenerator(a).generate_stream(duration_hours) for a in ids]
    return pd.concat(frames, ignore_index=True)


if __name__ == "__main__":
    os.makedirs("data/raw", exist_ok=True)
    data = generate_dataset()
    path = "data/raw/synthetic_astronaut_telemetry.csv"
    data.to_csv(path, index=False)
    print(f"Dataset generated: {path} | shape={data.shape}")
    print(data.groupby("astronaut_id")["scenario_label"].value_counts().unstack(fill_value=0))
