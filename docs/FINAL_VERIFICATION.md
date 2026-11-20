# Final technical verification

## Scope and results
Revision of the supplied GitHub-ready archive, not a reimplementation. No runtime source or workflow JSON was changed. No production endpoint was contacted. The supplied video is demonstration evidence, not a new integration test.

| Check | Result |
| --- | --- |
| Python 3.13.5 / pandas 2.2.3 / FastAPI 0.128.2 / Uvicorn 0.48.0 | Local environment observed |
| Uvicorn startup (simulation autostart disabled, loopback port 18765) | PASS |
| GET /health | 200; ONLINE, four astronauts |
| GET /api/v1/astronauts | 200; four entries; hybrid-v2.0 |
| GET /api/v1/report?astronaut_id=ASTRO_01 | 200 |
| GET /api/v1/events/feed?limit=1 | 200 |
| GET /api/v1/live/ticks?astronaut_id=ASTRO_01&limit=1 | 200 |
| POST /simulation/next | 404; legacy route missing |
| npm ci --offline (backend) | BLOCKED: ENOTCACHED yallist 4.0.0 |
| npm ci --offline (frontend) | BLOCKED: ENOTCACHED zod-validation-error 4.0.2 |
| Backend startup, SQLite initialization, end-to-end incident dedup/review, React build | NOT RUN; missing installed dependencies |
| n8n runtime import/execution, Gemini calls | NOT RUN; no local instance/credentials |

Prior integrated suite: 35 passed / 4 failed, 93.25 s; preserved [log](test-results/engine-pytest.txt). No fresh full-suite run is claimed. The original Windows Python 3.14 pinned environment (pandas 3.1.1) was not reproduced; whether it exhibits the same failures is unverified.

## Timestamp investigation

Failing tests:
- `tests/test_engine.py::test_all_injected_events_detected_on_every_astronaut_with_bounded_latency`
- `tests/test_engine.py::test_blind_astronauts_all_injected_events_detected`
- `tests/test_engine.py::test_control_astronaut_has_no_high_priority_event`
- `tests/test_live.py::test_live_events_equal_batch_events`

`engine/validator.py` normalizes timestamps with `pd.to_datetime(..., utc=True)`. `engine/generator.py` uses a timezone-free START_TIMESTAMP. `engine/evaluation.py:133,136` subtracts the naive normalized start from a timezone-aware serialized night start. The live/batch test compares a parsed event start with a raw timestamp; their timezone conventions differ. These are inconsistent time representations, not evidence of four missed anomalies.

Candidate, **not applied**: establish UTC at the generator/ingestion boundary and normalize evaluation dates with `pd.to_datetime(value, utc=True)`; examine serialized event start values and ensure raw and validated timestamps use the same convention. For evaluation alone, normalize both START_TIMESTAMP and night_start to UTC before subtraction. Confirm existing epoch interpretation and external contract first; adding offsets can affect consumers. Regression: run all four failing tests unchanged plus the full suite, compare event IDs, times, live/batch equivalence and sleep-night indexing with fixtures. Test naive, UTC and offset inputs representing the same instant. Recommend applying only after team approval and regression validation; do not edit assertions to mask the issue.

## Legacy generator

`backend/server.js` unconditionally invokes `startDataGeneration(io)`. `backend/data_generator.js` schedules POST `/simulation/next` every VITALS_INTERVAL (default 2 s), then calls `/predict/risk` and `/predict/anomaly`, persists legacy vitals and emits `vitals_update`/`doctor_alert`. The default ML_SERVICE_URL points to the active engine, which has no matching legacy routes; local POST confirmed 404. With that configuration, repeated caught simulation errors are expected. The generator has no disable flag today; setting a longer interval is not disabling it. Current astronaut and medical officer pages poll `/api/v1/live/ticks` directly, workspace reads `/api/v1/astronauts`, and incidents/actions use backend routes; no frontend subscription to the legacy socket event names was found. This supports, but does not prove, safe disablement for the current demo.

Proposed minimal change (not applied): guard the invocation with `if (process.env.ENABLE_LEGACY_GENERATOR === '1') startDataGeneration(io);`, default disabled, retain the legacy module and document the opt-in requires a compatible legacy service. Verify dashboard vitals/history, incident workflow, messaging, SQLite initialization and live updates before adopting. No fake service or replacement routes introduced.

## Security and publication

WF01–03 webhook triggers do not configure inbound authentication; outbound HTTP header credentials are separate. Screenshots are cropped to remove browser address bars; sticky notes are historical and are not verification evidence. No real .env or database snapshots included. Do not publicly expose runtime routes before auth, authorization, CORS and secret review. See [security](SECURITY.md). Rotate credentials if any real secret was previously exposed.

Independent reference: [v4.1.1 final report](../reference/engine-v4.1.1/TEST_REPORT_FINAL.md) records 48 Python, 7 Node, 19 shim HTTP tests. [Synthetic evaluation](../reference/engine-v4.1.1/outputs/evaluation_report.md) reports 4/4 injected events and 11 review-level false alarms over 15 astronaut-days. These are author-reported newer-release results, not current integrated validation.
