"""
Central configuration. Every threshold lives here with the reason it exists,
so the numbers can be defended (or changed) in one place.
"""

MODEL_VERSION = "hybrid-v2.0"
SCHEMA_VERSION = "1.0"
DISCLAIMER = (
    "Experimental research prototype for telemetry review and decision support. "
    "Not a medical device: it does not diagnose and gives no treatment instructions."
)

# ---------------------------------------------------------------- data ------
VITAL_COLUMNS = [
    "heart_rate_bpm",
    "hrv_ms",
    "spo2_pct",
    "skin_temp_c",
    "resp_rate_bpm",
]

# Hardware plausibility ranges (ENGINEERING assumption about wearable sensors,
# NOT clinical limits). A reading outside these is a sensor fault, not a patient state.
PLAUSIBILITY_BOUNDS = {
    "heart_rate_bpm": (30.0, 220.0),
    "hrv_ms": (5.0, 200.0),
    "spo2_pct": (70.0, 100.0),
    "skin_temp_c": (32.0, 42.0),
    "resp_rate_bpm": (4.0, 50.0),
}

SAMPLE_MINUTES = 5
STEPS_PER_HOUR = 60 // SAMPLE_MINUTES          # 12

# --------------------------------------------------------- data quality -----
FLATLINE_STEPS = 8        # 8 identical consecutive readings (40 min) = stuck sensor
MAX_GAP_STEPS = 6         # > 30 min of consecutive invalid rows = stream unusable
RECENT_QUALITY_STEPS = 36  # window (3 h) used to judge the *current* stream state
RECENT_INVALID_FRACTION = 0.25

# ------------------------------------------------------------ baseline ------
BASELINE_WINDOW_STEPS = 576       # first 48 h = calibration (2 full nights for sleep)
MIN_CALIBRATION_ROWS = 60         # valid rows needed to fit a baseline at all
MIN_CIRCADIAN_SPAN_HOURS = 18     # need ~a day of data to estimate a 24 h rhythm
CIRCADIAN_MIN_R2 = 0.10           # keep the 24 h term only if it explains >= 10 % of variance
# floors so a very quiet calibration window cannot create an absurdly tight baseline
MIN_RESIDUAL_STD = {
    "heart_rate_bpm": 1.0,
    "hrv_ms": 2.0,
    "spo2_pct": 0.2,
    "skin_temp_c": 0.05,
    "resp_rate_bpm": 0.3,
}

# ------------------------------------------------------------ detection -----
Z_SCORE_THRESHOLD = 3.0           # single-reading deviation (in baseline sigmas)
TREND_WINDOW_STEPS = 12           # 1 h rolling window for "sustained" shifts
TREND_MIN_PERIODS = 4
TREND_VITALS = ["heart_rate_bpm", "skin_temp_c", "hrv_ms"]
TREND_K = 4.0                     # trend threshold = K x SD of the rolling mean seen in calibration
TREND_Z_MIN = 1.0                 # ...but never below this (in sigmas)
ML_CALIBRATION_QUANTILE = 0.01    # Isolation Forest alarm budget: 1 % of calibration rows
ML_GATE_Z = 2.0                   # ML alone is not enough: needs a |z| >= 2 confirmation
Z_SATURATION = 6.0                # anomaly_score = min(1, deviation / 6)  (NOT a probability)

ACTIVE_STATES = {"ACTIVE"}        # planned exercise / EVA: physiology expected to change
CONTEXT_MASKED_VITALS = [
    "heart_rate_bpm", "hrv_ms", "resp_rate_bpm", "skin_temp_c",
]                                 # SpO2 is still monitored during activity

# ---------------------------------------------------------- alert / events --
ALERT_MIN_CONSECUTIVE = 3         # >= 3 consecutive flagged readings (15 min) ...
ALERT_Z_OVERRIDE = 4.0            # ... or a single very large deviation
EVENT_MERGE_GAP_STEPS = 6         # flagged rows closer than 30 min belong to one event
SUSTAINED_EVENT_MIN_MINUTES = 180   # drift episodes last hours; an acute spike + 1 h trend tail is < 3 h
HIGH_SCORE = 0.67                 # score >= 0.67  <=>  deviation >= 4 sigma
STATUS_WINDOW_STEPS = 36          # overall status looks at the last 3 h only
TREND_REPORT_MIN_POINTS = 24

# ------------------------------------------------------------------ sleep ---
SLEEP_STATE = "SLEEP"
SLEEP_MIN_NIGHT_HOURS = 2.0       # shorter sleep runs are naps, not nights
SLEEP_DEFICIT_HOURS = 1.0         # night is "short" if >= 1 h below personal baseline
SLEEP_CONSECUTIVE_NIGHTS = 2      # 2 short nights in a row = restriction trend
SLEEP_MIN_STD_HOURS = 0.5         # baseline from only 2 nights has no reliable SD

# ------------------------------------------------------------- streaming ----
STREAM_BUFFER_STEPS = 32          # > TREND_WINDOW_STEPS and > FLATLINE_STEPS
