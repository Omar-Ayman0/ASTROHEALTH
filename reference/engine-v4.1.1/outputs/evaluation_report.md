# Evaluation Report - Health Intelligence Engine

> Synthetic data written by the same team as the detector: this shows the engine behaves as designed, it is **not** clinical validation.

## Protocol

- `ASTRO_01` = development astronaut (design iterated while looking at it).
- `ASTRO_02-04` = **inspected**: different baselines/events, but their output was looked at while the design was being finished (the sleep-state term was added after seeing false alarms on `ASTRO_04`). Not blind.
- `ASTRO_05-07` = **blind**: generated after the design was frozen, new seeds/positions/magnitudes (one weak-event astronaut, one pure control). Run once, nothing tuned afterwards. **Quote this split.**
- Calibration = first 48 h; evaluation on the remaining ~5 days.
- Main metrics are event-level (recall, latency, false alarms/day). Row-level numbers are shown for completeness; rows in a grey zone (early drift ramp before 25 % build-up, and the 1 h after an event) are excluded from row-level scoring so that early detection is not punished.

## Final model - BLIND astronauts (ASTRO_05-07)

| Method | Row precision | Row recall | Row F1 | Event recall | Median latency (min) | Max latency (min) |
|---|---|---|---|---|---|---|
| statistical_zscore | 0.657 | 0.924 | 0.768 | 4/4 | 50.0 | 120 |
| isolation_forest_alone | 0.774 | 0.876 | 0.822 | 4/4 | 35.0 | 100 |
| trend_detector | 0.931 | 0.931 | 0.931 | 4/4 | 55.0 | 125 |
| hybrid_final | 0.563 | 0.952 | 0.708 | 4/4 | 35.0 | 100 |
| hybrid_alert_gated | 0.919 | 0.945 | 0.932 | 4/4 | 55.0 | 125 |

- Review-level false-alarm events: **11** over 15.0 astronaut-days (**0.733/day**); all events incl. single-reading LOW: 74.
- Data quality: injected corrupted rows 23, detected 16 (row recall 0.696), false corrupt rows 0. A stuck sensor is only declared after 8 identical readings, so its first 7 readings are (by design) not flagged.
- Sleep restriction: 3/3 restricted nights flagged (3 nights flagged in total).

## Final model - Inspected astronauts (ASTRO_02-04)

| Method | Row precision | Row recall | Row F1 | Event recall | Median latency (min) | Max latency (min) |
|---|---|---|---|---|---|---|
| statistical_zscore | 0.725 | 0.841 | 0.779 | 4/4 | 35.0 | 110 |
| isolation_forest_alone | 0.759 | 0.841 | 0.798 | 4/4 | 35.0 | 110 |
| trend_detector | 0.947 | 0.796 | 0.865 | 4/4 | 65.0 | 145 |
| hybrid_final | 0.597 | 0.86 | 0.705 | 4/4 | 35.0 | 110 |
| hybrid_alert_gated | 0.985 | 0.834 | 0.903 | 4/4 | 55.0 | 130 |

- Review-level false-alarm events: **3** over 15.0 astronaut-days (**0.2/day**); all events incl. single-reading LOW: 69.
- Data quality: injected corrupted rows 22, detected 15 (row recall 0.682), false corrupt rows 0. A stuck sensor is only declared after 8 identical readings, so its first 7 readings are (by design) not flagged.
- Sleep restriction: 2/3 restricted nights flagged (2 nights flagged in total).

## Final model - Development astronaut (ASTRO_01)

| Method | Row precision | Row recall | Row F1 | Event recall | Median latency (min) | Max latency (min) |
|---|---|---|---|---|---|---|
| statistical_zscore | 0.825 | 1.0 | 0.904 | 2/2 | 7.5 | 15 |
| isolation_forest_alone | 0.86 | 1.0 | 0.925 | 2/2 | 35.0 | 70 |
| trend_detector | 0.988 | 1.0 | 0.994 | 2/2 | 15.0 | 30 |
| hybrid_final | 0.741 | 1.0 | 0.851 | 2/2 | 7.5 | 15 |
| hybrid_alert_gated | 0.988 | 1.0 | 0.994 | 2/2 | 20.0 | 40 |

- Review-level false-alarm events: **1** over 5.0 astronaut-days (**0.2/day**); all events incl. single-reading LOW: 20.
- Data quality: injected corrupted rows 18, detected 11 (row recall 0.611), false corrupt rows 0. A stuck sensor is only declared after 8 identical readings, so its first 7 readings are (by design) not flagged.
- Sleep restriction: 3/3 restricted nights flagged (3 nights flagged in total).

## Ablation (all 7 astronauts pooled, hybrid detector)

| Configuration | HR sigma (bpm, mean) | Event recall | Median latency (min) | Review-level false alarms | per astronaut-day | of which during planned exercise |
|---|---|---|---|---|---|---|
| A_v1_style (flat baseline, no context) | 5.46 | 9/10 | 0.0 | 35 | 1.0 | 32 |
| B_+circadian/sleep baseline | 1.76 | 10/10 | 7.5 | 43 | 1.229 | 32 |
| C_final (+exercise context) | 1.76 | 10/10 | 7.5 | 15 | 0.429 | 0 |

> Config A's median latency is not comparable: with a flat baseline it already raises about one review-level false alarm per astronaut-day on normal data, so early 'detections' can be coincidences.

## Honest reading

- No single detector wins everywhere. The trend detector has the highest row precision but is the slowest (it needs about an hour of evidence). The single-reading z-score and Isolation Forest react faster but fire on isolated noise. The hybrid is as fast as the fastest single detector and covers both acute and drifting events, but its row-level precision is the lowest because it is a union of detectors.
- That row-level cost is contained by the persistence rule: isolated flags become LOW events and do not alert. `hybrid_alert_gated` is the row-level view of what actually raises an alert: much higher precision, at the price of ~20 min extra latency (it waits for persistence).
- Isolation Forest never alarms alone in the hybrid: its alarm budget is set on calibration data (1 % of calibration rows), which is not a disease prevalence.
- **False-alarm rate is the weak point.** Blind split: about 0.7 review-level events per astronaut-day, inspected split 0.2 (those astronauts were simply luckier), pooled over all 7 astronauts about 0.4. They are chance runs of >= 3 consecutive flagged readings (15 min) or a single 4-sigma value; with 5 vitals and autocorrelated noise this happens. Raising `ALERT_MIN_CONSECUTIVE` or `ALERT_Z_OVERRIDE` in `engine/config.py` would reduce them at the cost of latency, but that change has NOT been validated on a new blind set, so it was not applied.
- A moderate sleep restriction (about 0.75 h below baseline) is below the 1 h rule and is not flagged; that is a design choice, not a bug.
- Not evaluated: real astronaut data, microgravity-specific physiology changes, sensor drift over months, missing-data patterns of a real telemetry link.