# Scientific Foundation

> Applies to engine **v2.1** (`model_version = hybrid-v2.1`). Research prototype. Synthetic data only. Not a medical device, no diagnosis. Not endorsed by or affiliated with NASA.

## 1. Scientific foundation is not clinical validation

| | Status |
|---|---|
| The chosen indicators and the idea of a personal baseline have published support (section 4) | partly met |
| The system detects real medical conditions reliably | **not shown**: all data are synthetic and written by the same team as the detector |

The engine reports "different from this person's own normal, please review" (`HEALTH_REVIEW_REQUIRED`, `needs_human_review`). It never names a disease.

## 2. Actual data fields (from `engine/config.py`, `engine/schemas.py`, `engine/generator.py`)

Machine-readable meaning of each field, limits of inference and evidence level: `docs/signal_definitions.json` (also `GET /api/v1/evidence`, code in `engine/evidence.py`).

| Indicator | Engine field | Unit | Definition note |
|---|---|---|---|
| Heart rate | `heart_rate_bpm` | bpm | |
| Heart-rate variability | `hrv_ms` | ms | **The field name does not say the metric.** The engine **assumes RMSSD** (`HRV_METRIC` in `engine/config.py`); RMSSD and SDNN are not interchangeable and are never converted. A real dataset must declare `hrv_metric` in the adapter mapping. Published HRV values (see the r-MSSD rows of the evidence table) are only comparable when metric and window match |
| Oxygen saturation | `spo2_pct` | % | Reliability depends on sensor contact and motion |
| Skin temperature | `skin_temp_c` | degC | **Peripheral skin temperature, not core** (`SKIN_TEMP_SITE`). Published spaceflight temperature results are mostly core temperature (see section 4); they are not direct evidence for this field. Since v2.1 the simulator uses wrist-skin-like baselines (~33.8-34.2 degC, `SKIN_TEMP_OFFSET_C = -2.8`; v2.0 used core-like 36.60-36.95 degC); plausibility bound 28-42 degC |
| Respiratory rate | `resp_rate_bpm` | breaths/min | |
| Activity state | `activity_state` | REST / SLEEP / ACTIVE | |
| Sleep duration | derived | hours | **Not a sensor field**: computed from the time spent in `activity_state == SLEEP`. A dataset with one sleep value per night must be converted into SLEEP rows before import: `engine/adapter.py` does this (`nightly_sleep` in the mapping) and reports it as a reconstruction |
| Time, identity | `timestamp`, `astronaut_id` | | |

No field was renamed, added or removed (JSON contract unchanged in v2.1).

## 3. Engine configuration is our engineering choice, not a NASA standard

Sampling 5 min (12 per hour); calibration 48 h (576 readings, minimum 60 valid); circadian fit needs at least 18 h of data;
acute threshold |z| >= 3; single-reading override 4 sigma; sustained window 1 h (12 readings); minimum sustained event 180 min;
alert persistence 3 consecutive readings (15 min); short sleep night = 1 h below own baseline; 2 consecutive short nights = trend.
All values are in `engine/config.py`. None comes from a medical standard.

### Which detector watches which vital

| Mechanism | Vitals |
|---|---|
| Acute per-reading z-score against the personal time-of-day baseline | all five |
| Isolation Forest (never alarms alone, needs |z| >= 2 confirmation) | all five |
| Rolling sustained-trend detector (`TREND_VITALS`) | **all five vitals** (v2.1; v2.0 covered `heart_rate_bpm`, `skin_temp_c`, `hrv_ms` only) |
| Sleep analysis | derived sleep duration |

In v2.0, `spo2_pct` and `resp_rate_bpm` had no sustained-drift detector; v2.1 added one. This change was **not** validated on a new blind set: the blind result is unchanged (4/4 events, 11 review-level false alarms / 15 astronaut-days), see `docs/CHANGES.md`. Do not describe the thresholds as tuned for SpO2 / respiration.
During planned `ACTIVE` periods HR, HRV, respiration and skin temperature are masked; SpO2 is still scored.

## 4. What the public literature supports (numbers opened and checked)

| Topic | Finding | Evidence type | Source |
|---|---|---|---|
| Core temperature | +1.01 degC at rest, up to +1.39 degC in exercise, 11 astronauts, forehead heat-flux sensor | Published group-level result | [Stahn 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5701078) |
| Sleep | Mean in-flight sleep 5.96 h (Shuttle) and 6.09 h (ISS) | Published group-level result (secondary summary; primary paper not opened) | [EurekAlert](https://www.eurekalert.org/news-releases/595450) |
| Heart rate | Night HR 56.5-58.3 bpm, circadian amplitude 4.4-11.9 bpm | Actual measurement, one astronaut | [Sci Rep 2023](https://www.nature.com/articles/s41598-023-36389-6) |
| SpO2 | About 97% in 8 astronauts **under a hypoxic challenge** (not resting in-flight) | Analog / challenge | [ASMA 2017](https://www.ingentaconnect.com/contentone/asma/amhp/2017/00000088/00000006/art00004) |
| End-tidal CO2 | 36.0 to 42.1 mmHg in flight (no engine field) | Published group-level result | [PubMed 27662353](https://www.pubmed.gov/27662353/) |
| Personal baselines | 27 ISS astronauts compared with their own pre-flight timepoint; individual-specific changes (molecular biomarkers, exploratory, uneven data) | Published group-level result | [Frontiers in Physiology 2023](https://www.frontiersin.org/articles/10.3389/fphys.2023.1219221/full) |

The full evidence table with limitations is in `outputs/evidence_table.csv` / `.json` (9 rows, identical content in both files). Anything not listed has **insufficient publicly accessible evidence** in what was opened.

## 5. What is a synthetic assumption

Baselines, ACUTE_ANOMALY and SUSTAINED_DRIFT magnitudes, noise and thresholds in `engine/generator.py` and `engine/config.py`.
The simulator's normal night (7.4 h) is Earth-like; its restricted nights (5.2-6.4 h) are close to the published in-flight mean of about 6 h.

## 6. Limitations

Small samples (some N=1); core is not skin temperature; no public astronaut time-series dataset mapped to these fields was found;
thresholds were tuned on synthetic data only (the v2.1 five-vital trend detector was not re-validated on a new blind set); SpO2/HRV deviations can come from motion, sensor placement, activity or environment (e.g. CO2) that the engine cannot see.
Radiation, bone and muscle loss, immunity, glucose and psychiatric state are outside the current indicators and are not monitored.
