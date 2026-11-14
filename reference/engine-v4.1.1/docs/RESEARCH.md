# Research & Assumptions

> Experimental research prototype for telemetry review and decision support. Not a medical device, no diagnosis, no treatment advice.
> All data in this project are **synthetic**. No real astronaut data, no real medical thresholds.

This document says, for every indicator, **why it is monitored**, **what source supports it**, and **what is only our assumption**.
Anything without a source is labelled as such: do not present it to the committee as established fact.

## 1. Why a *personal* baseline

NASA's Human Research Program tracks the risk of performance decrements and adverse health outcomes from sleep loss,
circadian desynchronization and work overload. The evidence report notes that sleep need, circadian preference and the response
to sleep loss differ between individuals, and that more work is needed to quantify an individual astronaut's sleep need.
A population threshold ("HR > 100 is abnormal") therefore says little about one person; comparing a person with **their own** normal
is the defensible design. This is the project's central scientific argument.

## 2. Indicators

| Indicator | Role | Why it is monitored | Source status |
|---|---|---|---|
| Resting heart rate (`heart_rate_bpm`) | Core | Spaceflight exposure can contribute to cardiovascular deconditioning and remodelling (NASA HRP cardiovascular risk). HR is the cheapest continuous cardiovascular signal. | Sourced (1, 2, 3) |
| Sleep duration (derived from `activity_state == SLEEP`) | Core | Reduced sleep and circadian misalignment are documented on the ISS and are a named NASA risk. | Sourced (4, 5, 6) |
| HRV (`hrv_ms`) | Supporting | Autonomic marker used in spaceflight cardiology studies; the 24 h component of HRV was reported to persist in long-duration flight. | Sourced (2, 3) |
| Planned exercise (`activity_state == ACTIVE`) | Context | ISS crews use daily exercise as a countermeasure (reported up to about two hours a day). Exercise raises HR, so it must not be read as an anomaly. | Sourced (7) |
| Blood oxygen (`spo2_pct`) | Supporting | Oxygenation; wearables recorded SpO2 in the Inspiration4 crew study (cited in the team's research report, exact reference to be added). Scored even during exercise. | Partly sourced: the only public figure found is ~97% in 8 astronauts **under a hypoxic challenge**, not resting in-flight (`docs/SCIENTIFIC_FOUNDATION.md` section 4) |
| Respiratory rate (`resp_rate_bpm`) | Supporting | Detects a change in breathing rate relative to the person's own normal. It does not diagnose disease. | **No source for this field.** Only end-tidal CO2 was found and it has no engine field (`outputs/evidence_table.*`) |
| Skin temperature (`skin_temp_c`) | Supporting | **Peripheral skin temperature, NOT core body temperature.** Do not apply numbers from core-temperature studies to it. | Core-temperature literature only (Stahn 2017, +1.01 degC at rest, 11 astronauts): **not direct evidence** for skin temperature. See `docs/SCIENTIFIC_FOUNDATION.md` section 4 |

### 2b. What each field means (v2.1 scientific audit)

Full machine-readable version: `docs/signal_definitions.json` (also `GET /api/v1/evidence`), code in `engine/evidence.py`.

* **Skin vs core temperature.** `skin_temp_c` is declared as peripheral skin temperature. The synthetic generator used core-like values (36.6-36.95 C); v2.1 shifts them by `SKIN_TEMP_OFFSET_C = -2.8` to a wrist-skin-like ~34 C. Detection is baseline-relative, so results are unchanged; only the numbers are physically honest. Plausibility lower bound lowered 32 -> 28 C because peripheral skin can read cold. The field name stays (JSON contract); free-text explanations say "peripheral skin temperature, not core".
* **HRV definition.** `hrv_ms` does not say whether it is RMSSD or SDNN. The engine assumes RMSSD (`HRV_METRIC` in config). They are not interchangeable, are never converted, and must not be mixed inside one astronaut's stream. Real datasets must declare `hrv_metric` in the adapter mapping; numbers from papers are only comparable if metric and window match.
* **Sustained-drift detector.** v2.0 watched only HR, skin temperature and HRV for sustained shifts. v2.1 covers all five vitals (`TREND_VITALS`). SpO2 and respiration previously had single-reading z-scores and the 3 h slope report only. Effect on the evaluation: see `outputs/evaluation_report.md` and `docs/CHANGES.md` (headline numbers unchanged).
* **Sleep duration is derived**, not a sensor field. Datasets with one value per night go through `engine/adapter.py`, which reconstructs SLEEP rows and says so in its warnings.

### 2c. Scientific foundation vs clinical validation

The choice of indicators and the personal-baseline approach have a scientific foundation. The system itself has **not** been clinically validated: it was tested on synthetic data written by the same team. All thresholds in `engine/config.py` (5 min sampling, 48 h calibration, z = 3, 60 min trend window, 180 min sustained event, 3 readings / 15 min persistence, 4 sigma override, 1 h sleep deficit, 2 nights) are **engineering configuration, not NASA medical standards**.

### 2d. Out of scope with the current indicators

* Radiation exposure: needs a radiation dosimeter.
* Bone and muscle loss: needs imaging, strength or biochemical measurements.
Do not claim the system monitors them.

## 3. Design decisions that come from the research

1. **Baseline per astronaut**, fitted on the first 48 h (two full nights).
2. **Time-of-day aware baseline.** The 24 h rhythm of heart rate and HRV is reported to persist in spaceflight (2, 3), so comparing a 03:00 reading with a 15:00 average is wrong. The baseline is a 24 h harmonic fit plus a sleep-state term.
   Caveat: the literature does not agree on whether the *amplitude* of the HR rhythm gets stronger or weaker in flight (the cited sources describe a preserved or strengthened rhythm; older NASA reports describe reduced diurnal variation). Either way it changes, so the baseline must be **re-fitted on in-flight data**, never copied from ground data.
3. **Exercise context.** Vitals that exercise moves are not scored during planned activity; SpO2 still is.
4. **Sleep is judged over several nights**, not one night (2 consecutive short nights = trend).
5. **Isolation Forest is an experiment, not the decision-maker**: it never alarms alone.

## 4. Assumptions (ours, not NASA's)

* Sampling: 1 reading / 5 min (288 / day).
* Hardware plausibility bounds (sensor faults, **not** clinical limits): HR 30-220 bpm, HRV 5-200 ms, SpO2 70-100 %, skin temperature 32-42 C, respiration 4-50 /min.
* Stuck-sensor rule: 8 identical consecutive readings (40 min). Unusable stream: more than 6 consecutive invalid readings (30 min).
* Sigma floors per vital, trend threshold = 4 x the SD of the 1 h rolling mean seen in the astronaut's own calibration, Isolation Forest alarm budget = 1 % of calibration rows. All in `engine/config.py`.
* Short sleep night = at least 1 h below the personal baseline. A baseline made of 2 nights has no reliable SD, so a 0.5 h floor is used.
* Synthetic physiology: HR 5 bpm circadian amplitude, -4 bpm during sleep, +30 bpm at peak exercise, AR(1) noise (phi 0.5). These numbers make the demo plausible; they are not measurements.

## 5. Limitations (say them before the committee asks)

* The data generator and the detector were written by the same team: results show the engine behaves as designed, **not** clinical validity.
* No real telemetry, no microgravity-specific changes beyond the circadian/sleep/exercise structure, no sensor drift over months.
* The false-alarm rate is about 0.2-0.7 review-level events per astronaut-day on synthetic noise (see `outputs/evaluation_report.md`).
* The detector cannot tell the *cause* of a deviation (illness, stress, schedule change, sensor placement). It only says "different from this person's normal, please review".
* Planned-activity masking means a real emergency *during* exercise is only caught through SpO2.

## 6. Sources

1. NASA, *Risk of Cardiovascular Adaptations Contributing to Adverse Mission Performance and Health Outcomes* (Human Research Program risk page): https://www.nasa.gov/directorates/esdmd/hhp/risk-of-cardiovascular-adaptations-contributing-to-adverse-mission-performance-and-health-outcomes/
2. Systematic review of cardiovascular adaptations to real and simulated space travel, *Cardiology* 148(5): https://karger.com/crd/article/148/5/434/845106 (reports, e.g., that the 24-, 12- and 8-hour components of HRV persisted during 6-month flights, citing Otsuka et al. 2016, PMID 28050606).
3. Otsuka et al., heart-rate-variability analysis of an astronaut over a 12-month flight, *Scientific Reports* (2022): https://link.springer.com/10.1038/s41598-022-14858-8
4. NASA, *Risk of Performance Decrements and Adverse Health Outcomes Resulting from Sleep Loss, Circadian Desynchronization, and Work Overload* (HRP risk page): https://www.nasa.gov/directorates/esdmd/hhp/risk-of-performance-decrements-and-adverse-health-outcomes-resulting-from-sleep-loss-circadian-desynchronization-and-work-overload
5. NASA HRP Evidence Report on the same risk (NTRS 20160003864): https://ntrs.nasa.gov/api/citations/20160003864/downloads/20160003864.pdf
6. NASA, *Fatigue-Related Countermeasures for Long-Duration Exploration Missions* (NTRS 20140003280): https://ntrs.nasa.gov/citations/20140003280 (states that on the ISS sleep is reduced and circadian misalignment is present).
7. Northwestern University study of 13 astronauts and exercise countermeasures, summarised in ScienceDaily, 21 Oct 2026: https://sciencedaily.com/releases/2026/10/261020085016.htm

8. Inspiration4 crew wearable study (HR, HRV, SpO2 during mission phases), *Nature* family journal: cited in the team's research report; **find the exact title/DOI and add it here before presenting.** Canadian Space Agency sources named in that report are likewise not listed here yet.

*To do before presenting:* read sources 2-5 yourself (the summaries above come from search excerpts, not from reading the full papers), add 1-2 sources for skin temperature and respiration (and the exact SpO2 reference), and cite the exact figures you quote.
