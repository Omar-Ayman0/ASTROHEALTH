# Astronaut Health Intelligence Engine (v2)

Local, offline-first analysis engine for astronaut telemetry: personal baseline, data-quality checks,
anomaly + trend detection, sleep analysis, explainable JSON for Backend / n8n / Dashboard.

> Experimental research prototype for telemetry review and decision support. **Not a medical device.**
> All data are **synthetic**; nothing here is a real medical threshold.

## Run (VS Code terminal, Windows)

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

python main_pipeline.py          :: generates data, analyses 4 astronauts, writes reports, charts, evaluation
python tests\test_engine.py      :: 23 engine tests
python tests\test_live.py        :: 11 live/integration tests   (or: pytest -q)
uvicorn api_server:app --port 8000     :: then open http://127.0.0.1:8000/docs
curl -X POST "http://127.0.0.1:8000/api/v1/simulation/start?interval_seconds=1"   :: live analysis of all astronauts
```

## What is in the box

```
engine/
  config.py          every threshold + why it exists
  generator.py       synthetic telemetry (7 astronauts: 4 demo + 3 blind), circadian rhythm, sleep, exercise, scenarios
  validator.py       bounds / missing / flatline checks, NO imputation, causal
  baseline.py        personal baseline: 24 h rhythm + sleep state, fitted on first 48 h
  detector.py        z-score + trend + Isolation Forest (never alone) -> hybrid; exercise context
  trend_analysis.py  incidents (events), nightly sleep analysis, 3 h residual trends
  health_engine.py   HealthEngine, StreamSession (real per-reading analysis), analyze_health(), evaluate_instant()
  live.py            LiveSystem: several astronauts live, event tracker (1 incident = 1 event), feed, background simulation
  contract.py        JSON contract validator          evaluation.py  honest evaluation + ablation
  charts.py          presentation charts              schemas.py     API request models
main_pipeline.py     end-to-end run                   api_server.py  FastAPI service
tests/                test_engine.py (23) + test_live.py (11)   demo_notebook.ipynb  step-by-step walkthrough
docs/                INTEGRATION.md (for Backend/n8n/Dashboard)  JSON_CONTRACT.md  RESEARCH.md  DEMO_SCRIPT.md  CHANGES.md
outputs/             evaluation_report.md/.json, sample_analysis.json, samples/ (integration), reports/, charts/
```

## Results (details and caveats in `outputs/evaluation_report.md`)

Quote the **blind** split (ASTRO_05-07, generated after the design was frozen and run once):

| | Blind astronauts |
|---|---|
| Injected physiological events detected | 4 / 4 (median latency 35 min, max 100 min) |
| Restricted sleep nights flagged | 3 / 3 |
| Review-level false alarms | **11 in 15 astronaut-days (0.73 / day)** |
| Row-level, alerts only (`hybrid_alert_gated`) | precision 0.92, recall 0.95 |

Weak points to say out loud: the false-alarm rate is the weakest number (0.2/day on the inspected astronauts, 0.73/day on the blind ones);
the hybrid's row-level precision is low (0.56) because it is a union of detectors; a stuck sensor is only recognised after 8 identical readings
(row-level recall of injected corruption is about 0.70); a moderate sleep restriction (< 1 h below baseline) is not flagged by design.

Ablation (7 astronauts pooled): flat v1-style baseline -> HR sigma 5.46 bpm, 1.0 false alarms/astronaut-day;
time-of-day + sleep-aware baseline alone -> sigma 1.76 bpm but 1.23 false alarms/day (the tighter sigma makes exercise spikes look *more* abnormal);
adding the exercise context -> 0.43 false alarms/astronaut-day, none during planned exercise. The two changes only make sense together.

## Honest limits
Synthetic data written by the same team as the detector: shows the engine behaves as designed, **not** clinical validity.
