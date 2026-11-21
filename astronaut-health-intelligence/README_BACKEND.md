# ASTROHEALTH Engine: backend handoff (final v4.1.1)

Engine `MODEL_VERSION = hybrid-v2.1`, `SCHEMA_VERSION = 1.0`. **JSON contract unchanged.** No detector, baseline or threshold changed in this delivery.
Research prototype for telemetry review and decision support. **Not a medical device, no diagnosis.** All bundled data are synthetic (`is_real_astronaut_data: false`).

## Start here
1. `WINDOWS_SETUP.md`: Python version, requirements file, venv, every command for PowerShell.
2. `TEST_REPORT_FINAL.md`: what was actually run, what passed, what was NOT run, known issues.
3. `docs/NODE_INTEGRATION.md`: how to plug it into the existing Node/Express/SQLite backend (section 6) without touching it.
4. `docs/JSON_CONTRACT.md`, `docs/INTEGRATION.md`, `docs/CHANGES.md`.

## Package map
| Path | What |
|---|---|
| `engine/` | Python engine (baseline, detectors, live system, contract validator, adapter for real data) |
| `api_server.py` | FastAPI server (`uvicorn api_server:app`) |
| `tests/` | `test_engine.py` (28), `test_live.py` (20), `smoke_api.py` (HTTP, 6 astronauts), `stdlib_shim_server.py` (test server used by the Node tests) |
| `integration/node/` | `EngineClient`, `EnginePoller`, `SqliteStore`, Express router, `npm test` (7) |
| `outputs/samples/` | real response examples (feed, events, live ticks, reports) |
| `scripts/windows_verify.ps1` | runs all checks on Windows (not executed on Windows by the author) |
| `requirements-tested-py313.txt`, `requirements.txt` | see `WINDOWS_SETUP.md` section 0 |

## Requirements in one line
Python **3.13 tested** (3.12 allowed by the package metadata, not run; 3.14 not run) | Node **>= 22.13** | `pip install -r requirements-tested-py313.txt` in a separate venv, plus `pip install fastapi==0.162.4` for `api_server.py`.

## What the backend must know
* `vitals_involved[].vital` identifies the affected vital. Never search the free text (`explanation`, `key_findings` contain tags like "skin_temp_c (peripheral skin temperature, not core)" and "hrv_ms (RMSSD)").
* `skin_temp_c` = peripheral skin temperature, not core. `hrv_ms` assumed RMSSD. Baseline calibrates over the first 48 h and is then frozen.
* `/live/ticks` cursor is `since_seq` (not `since_step`); `/events/feed` cursor is `next_since_seq` (not `last_sequence`); send `engine_instance_id` back.
* Store events by `emission_id`, ticks by `(instance_id, astronaut_id, tick_seq)`; keep the full JSON in `payload`.
* Per astronaut, **either** the simulator **or** `/live/ingest` supplies data: the engine does not enforce it (known issue).
* The `onNewEvents` hook must be durable and the incident upsert idempotent by `event_id` (known issue, `docs/NODE_INTEGRATION.md` section 6).
