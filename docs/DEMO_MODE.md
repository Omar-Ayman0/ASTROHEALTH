# Temporary Demo Mode

A switchable, isolated, rollback-able mode that makes the engine emit a few **clearly labelled synthetic**
`HEALTH_REVIEW_REQUIRED` events, so the backend (incident upsert), n8n (WF01/WF03/WF05) and the dashboards have
something to process during the demo. It replaces `docs/DEMO_TEST_EVENTS.md` / `tests/test_demo_injector.py` of the
first version (the old `HEALTH_DEMO_INJECT=1` still works as an alias of `HEALTH_DEMO_MODE=1`).

**Off by default.** With the flag off: `make_live_system()` returns the plain `LiveSystem`, no `/api/v1/demo/*` route
exists, no `HEALTH_DEMO_*` variable other than the flag is read, and nothing in `demo_injector.py` runs.

## What is (not) changed
| Changed / added | Not changed |
|---|---|
| NEW `engine/demo_injector.py`, NEW `tests/test_demo_mode.py`, NEW `docs/DEMO_MODE.md` | detectors, ML, baselines, thresholds, rules |
| `api_server.py`: 1 import line, `_boot` calls `make_live_system(...)` instead of `LiveSystem(...)`, 1 line `register_demo_routes(app, _boot)` | existing endpoints, their responses (flag off), file names |
| flag ON only: `/api/v1/demo/*` routes and a `demo_mode` object inside `GET /api/v1/simulation/status` | JSON contract of reports, ticks, events, feed; the backend; n8n; dashboards |

## Quick start
```
set HEALTH_DEMO_MODE=1
set HEALTH_SIM_AUTOSTART=1
python -m uvicorn api_server:app --host 127.0.0.1 --port 8000
```
Default behaviour: armed at boot, scenario `medium_then_high`: a MEDIUM event at the 10th simulated reading, a HIGH
event at the 20th, then the mode switches itself off (auto-reset). `GET /api/v1/demo/status` shows where it is.

Controlled start instead of boot-time: `set HEALTH_DEMO_AUTOSTART=0`, then `POST /api/v1/demo/start` when you want it.

## Configuration (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `HEALTH_DEMO_MODE` | off | `1` enables the mode. Anything else = off. |
| `HEALTH_DEMO_SCENARIO` | `medium_then_high` | `medium_then_high`, `medium_only`, `high_only`, `full_lifecycle` (both resolved 15 attempts later), `manual` (only `POST /demo/trigger`) |
| `HEALTH_DEMO_SCENARIO_FILE` | – | path of a JSON playbook (overrides `HEALTH_DEMO_SCENARIO`): `{"label":"x","steps":[{"at":4,"severity":"HIGH"},{"at":9,"severity":"MEDIUM"}],"resolve_after":0,"repeat_every":0}` |
| `HEALTH_DEMO_AUTOSTART` | `1` | `0` = stay IDLE until `POST /api/v1/demo/start` |
| `HEALTH_DEMO_AUTO_RESET` | `1` | after the scenario (and its resolutions) the mode returns to IDLE by itself; `0` = stay COMPLETED |
| `HEALTH_DEMO_MAX_EVENTS` | `6` | hard cap of synthetic events per run |
| `HEALTH_DEMO_ASTRONAUT` | all | only this astronaut's readings are counted/used, e.g. `ASTRO_03` |
| `HEALTH_DEMO_SCHEDULE`, `_REPEAT_EVERY`, `_RESOLVE_AFTER` | from scenario | optional overrides, e.g. `3:MEDIUM,6:HIGH` (a fast rehearsal) |

Wrong values (unknown scenario, bad schedule, unknown astronaut, missing file) stop the engine at boot with a clear
message instead of being ignored. An "attempt" = one reading of the simulator processed (retries of the same reading
are not counted again).

## Lifecycle
```
IDLE --start--> ARMED --scenario finished--> IDLE (auto-reset)      [COMPLETED if HEALTH_DEMO_AUTO_RESET=0]
ARMED --stop / reset--> IDLE
```
| Route (only with the flag on) | Effect |
|---|---|
| `GET /api/v1/demo/status` | state, scenario, counters, `last_run` |
| `POST /api/v1/demo/start?scenario=&astronaut_id=` | arm a new run (optional different scenario); 409 if already ARMED |
| `POST /api/v1/demo/trigger?severity=MEDIUM\|HIGH&astronaut_id=` | queue one event for the next simulator reading (works in any scenario while ARMED) |
| `POST /api/v1/demo/stop?resolve_open=false` | disarm and clear everything; `resolve_open=true` also sends `HEALTH_EVENT_RESOLVED` for the synthetic incidents still open |
| `POST /api/v1/demo/reset?start=false` | clear everything (counters, de-dup memory, queued triggers); `start=true` re-arms |

`POST /api/v1/simulation/reset` (full) also starts a new demo run (re-armed only if `HEALTH_DEMO_AUTOSTART=1`).
Demo mode starts **no thread and no timer**; all work happens inside the reading that is being processed, so
stop/reset/auto-reset have no background task to clean up, and the engine needs no restart afterwards.

## Isolation from live ingestion
* Synthetic events are created only for readings produced by the built-in simulator (`step_once`: the simulation loop
  and `GET /simulate/next`). Readings sent with `POST /api/v1/live/ingest` never trigger one; they are only counted
  in `external_ingests_seen`, so mixing is visible.
* Data declared real (`data_source.is_real_astronaut_data=true`) never triggers one.
* Synthetic events contain no telemetry; ticks (`/live/ticks`) and reports are exactly the engine's own, and they never
  list the synthetic event.

## Event metadata (schema unchanged, additive markers only)
Same envelope and event keys as a real `HEALTH_REVIEW_REQUIRED`, plus: `is_simulated:true` (envelope, `event`,
`data_source`), `data_source.injection:"demo_test_event"`, `event_id` containing `-DEMO-`
(`ASTRO_01-DEMO-HIGH-A0020-<instance>[-E<run>]`, manual ones `-M001-`), `scenario_context_demo_only`, and the text
"SYNTHETIC DEMO TEST EVENT (not a medical finding)" at the start of `explanation` and `review_reason`.
Numbers come from the astronaut's real time-of-day expectation and baseline sigma.

## Rollback (nothing else to undo)
1. Unset `HEALTH_DEMO_MODE` and restart: the original behaviour, immediately; or
2. permanently: `git apply -R patches/api_server_demo_mode.patch` (or restore the original `api_server.py`) and delete
   `engine/demo_injector.py`, `tests/test_demo_mode.py`, `docs/DEMO_MODE.md`.

## Known limitations (read before the demo)
* Not run against a real FastAPI/uvicorn, Windows, the real backend, n8n or the dashboards (only the engine, its tests
  and the route registration with a stand-in were exercised). Do a rehearsal with `HEALTH_DEMO_SCHEDULE=3:MEDIUM,6:HIGH`.
* **The synthetic event is processed like a real one downstream:** incident upsert, outbox/WF01, WF05 triage and the
  escalation reminder (default ~5 min). Use test recipients or leave notification workflows inactive; filter with
  `event_id LIKE '%-DEMO-%'` or `payload_json` `is_simulated`.
* The current dashboard cards do not display `is_simulated`; the audience will see a normal incident.
* `HEALTH_EVENT_RESOLVED` for an incident the backend does not have is answered 404 by `engine_sync_worker.js`
  and blocks its cursor: use `full_lifecycle` / `resolve_after` / `stop?resolve_open=true` only if the incident exists.
* `stop`/`reset` do not retract events already delivered (the backend keeps them) unless `resolve_open=true`.
* The simulator must be running (or `GET /simulate/next` called) for events to appear; with `manual`, the event
  appears at the next simulator reading, not instantly.
* State is in memory: an engine restart clears the run; a new `engine_instance_id` starts a new feed.
* Pre-existing, unrelated: 4 tests of the original suite fail on pandas `Timestamp` (`test_engine` x3, `test_live` x1)
  also without this feature.
