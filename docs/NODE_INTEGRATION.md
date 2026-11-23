# Node.js / Express integration (short guide)

> Research prototype, synthetic data, not a medical device. Field reference: [`JSON_CONTRACT.md`](JSON_CONTRACT.md). Full integration notes: [`INTEGRATION.md`](INTEGRATION.md).

## 0. What was verified, and what was not

The actual numbers of the final delivery are in [`TEST_REPORT_FINAL.md`](TEST_REPORT_FINAL.md) (measured after unpacking the delivery zip into an empty folder). Summary of what is **not** proven:

* `api_server.py` with **real FastAPI + Uvicorn** was **not run** by me (no network, FastAPI could not be installed). Its handler code was executed with a stand-in for `fastapi` (19/19 checks) which is **not** the same thing. Run `WINDOWS_SETUP.md` section 4 once.
* `expressRouter.js` is syntax-checked only (Express not installed).
* Python 3.12 and 3.14 were not run; 3.13 was. See `WINDOWS_SETUP.md` section 0.
* Nothing was run on Windows. The Node test now finds Python without assuming `python3` (simulated: PATH with only `python`, and PATH with no Python at all), but it was not executed on a Windows machine.

`tests/stdlib_shim_server.py` is a test harness: the same routes and the same `LiveSystem` calls as `api_server.py`, on the Python standard library, serialising with strict `json.dumps`.
It proves the data and the cursor logic over real HTTP. It does not prove FastAPI itself starts.

No analysis algorithm was changed (detector, baseline, validator, trend analysis, Isolation Forest are untouched by the delivery fixes).

## 1. Run (3 terminals)

```bat
:: engine (Python venv: see WINDOWS_SETUP.md for the version and requirements file to use)
pip install -r requirements.txt
set HEALTH_ASTRONAUT_COUNT=6
uvicorn api_server:app --port 8000
:: optional: set HEALTH_SIM_AUTOSTART=1 and HEALTH_SIM_INTERVAL=1.0 first to start the simulation at boot

:: smoke test (second terminal) - run it on a fresh engine, it resets ASTRO_01/02
python tests\smoke_api.py http://127.0.0.1:8000 --astronauts 6 --stateless --docs

:: backend (Node >= 22.13)
cd integration\node
npm test                      :: spawns the Python test server itself, no FastAPI needed
set "ENGINE_URL=http://127.0.0.1:8000" && npm test   :: same tests against the REAL server (fresh engine only; skips the restart/engine-down steps)
```

In your Express app:

```js
const { EngineClient, SqliteStore, EnginePoller, createEngineRouter } = require('./integration/node/src');
const client = new EngineClient({ baseUrl: process.env.ENGINE_URL || 'http://127.0.0.1:8000' });
const store  = new SqliteStore(process.env.ENGINE_DB || './engine.db');       // its OWN file, see section 6. Or your own store, same interface (poller.js header)
const poller = new EnginePoller({ client, store, intervalMs: 2000,
  onNewEvents: async (events) => { /* forward to your outbox / n8n webhook: only NEW messages arrive here */ } });
app.use('/api/health-engine', createEngineRouter(express, { client, store, poller }));
poller.start();
```

## 2. Contract changes made (and why)

Agreed fields were **not** renamed or removed. Three additions fixed real data-loss bugs in the pull cursors:

| Change | Reason |
|---|---|
| `GET /live/ticks`: cursor is `since_seq` (was `since_step`); response is an object `{..., next_since_seq, has_more, ticks[]}` (was a bare list); each tick has `tick_seq` and `run`. **Breaking for anyone who already called `/live/ticks`** | `step_index` goes back after `simulation/reset`; a backend that had read up to 1400 would have skipped every new tick |
| `GET /events/feed`: use `next_since_seq` as cursor, plus `has_more`. `last_sequence` is kept but is not a cursor | A page cut by `limit` followed by `last_sequence` skipped events |
| `engine_instance_id` query parameter on `/live/ticks` and `/events/feed`; responses carry `engine_instance_id` and `instance_changed` | After an engine restart `sequence` and `tick_seq` start again at 1; the backend could not notice and silently ignored the new data |

`GET /report`, `GET /events`, `GET /astronauts`, `POST /live/ingest`, the event envelope and the report schema (`schema_version 1.0`) are unchanged.

## 3. Mapping: engine data -> backend storage (nothing is dropped)

I have not seen your Backend's database models, so this is the mapping to the **reference tables** in `integration/node/src/sqliteStore.js`
(`engine_ticks`, `engine_events`, `engine_reports`, `engine_cursors`). Rule that guarantees no data loss: **the complete engine JSON is stored unchanged in a
`payload` column**; every other column is only a copy of one field for filtering and indexing. If your Backend already has tables for the same things,
add a `payload` JSON column to them and fill the columns below; send me the models if you want this mapped to them exactly.

**Readings (`GET /live/ticks` -> `engine_ticks`; input to `POST /live/ingest`)**

| Engine field | Backend column | Notes |
|---|---|---|
| `astronaut_id` | `astronaut_id` | `ASTRO_01`..`ASTRO_06`, same ids everywhere |
| (response) `engine_instance_id` | `instance_id` | part of the key, see below |
| `tick_seq` | `tick_seq` | unique with `(instance_id, astronaut_id)` |
| `run`, `step_index` | `run`, `step_index` | `step_index` is the replay position, not a key |
| `timestamp` | `ts` | `YYYY-MM-DD HH:MM:SS`, mission clock, no timezone (as sent by the data source) |
| `activity_state` | `activity_state` | `REST` / `SLEEP` / `ACTIVE` |
| `intelligence.hybrid_anomaly`, `.anomaly_score`, `.max_zscore` | `hybrid_anomaly`, `anomaly_score`, `max_zscore` | |
| `trigger_alert` | `trigger_alert` | `trigger_n8n_alert` is the same value, kept only inside `payload` |
| `data_quality.is_corrupted` | `is_corrupted` | |
| `vitals`, `expected_now`, `zscores`, rest of `intelligence`, `data_quality`, `emitted_events`, `demo_only_scenario_label`, `report_generated_at`, `model_version` | only in `payload` | read with `JSON.parse(payload)` |

Raw input fields for `POST /live/ingest`: `astronaut_id`, `timestamp`, `heart_rate_bpm`, `hrv_ms`, `spo2_pct`, `skin_temp_c`, `resp_rate_bpm`, `activity_state` (`outputs/samples/raw_telemetry_reading.json`).

**Event messages (`GET /events/feed` -> `engine_events`)**

| Engine field | Backend column | Notes |
|---|---|---|
| `emission_id` | `emission_id` (PRIMARY KEY) | idempotency key: the same message twice is stored once |
| `event_id` | `event_id` | **the incident id**: all messages of one incident share it |
| `event_type` | `event_type` | `HEALTH_REVIEW_REQUIRED` creates the incident; `HEALTH_EVENT_ESCALATED` and `HEALTH_EVENT_RESOLVED` update it |
| `astronaut_id`, `sequence`, `engine_instance_id`, `created_at`, `emitted_at` | same names (`instance_id` for the instance) | `created_at` = reading time, UTC `Z`; `emitted_at` = wall clock |
| `event.severity`, `event.type`, `event.status`, `event.needs_human_review`, `event.anomaly_score`, `event.duration_minutes` | `severity`, `incident_type`, `incident_status`, `needs_human_review`, `anomaly_score`, `duration_minutes` | |
| `event.vitals_involved[]`, `event.explanation`, `event.review_reason`, `event.triggered_by`, `event.start/end`, `event.flagged_readings`, `event.peak_zscore`, `run`, `data_source`, `schema_version`, `source` | only in `payload` | |

**Reports (`GET /report` -> `engine_reports`)**: one row per new reading per astronaut `(astronaut_id, latest_reading_at)`; columns `generated_at`, `status`, `severity`,
`needs_human_review`, `anomaly_score`; the whole report (`baseline`, `observed`, `trend_analysis`, `sleep`, `key_findings`, `events`, `latest_vitals`, `data_quality`, ...) in `payload`.
For the dashboard prefer proxying `GET /report` live (always the latest) and use the stored rows for history.

**Cursors (`engine_cursors`)**: keys `feed` and `ticks:<astronaut_id>`, value `{instanceId, seq}`, saved in the same transaction as the page they belong to.

Behaviours to know: (1) after an engine restart the replayed incidents get the **same** `emission_id`s, so they are ignored as duplicates (idempotent), while readings are kept
under the new `instance_id`; (2) the engine keeps the last 5000 readings per astronaut in memory (`gap_detected=true` if you were away longer than that); (3) the engine writes
events to `data/live/events.jsonl` but does not re-serve them after a restart.

## 4. Six independent astronauts

`HEALTH_ASTRONAUT_COUNT=6` (up to 7). Each astronaut has its own baseline, report, readings buffer, `tick_seq`, event tracker and `run`. Tests
(`test_six_astronauts_*`, `test_resetting_one_astronaut_leaves_the_other_five_untouched`, smoke test with 6) check independence, per-astronaut filtering of the feed and
that resetting one astronaut does not move the other five. Cost: about 0.4 s of compute per round with 6 astronauts, so `interval_seconds=1` is safe.

## 5. What is needed from your side

1. Run the 3 commands in section 1 once with the real FastAPI server and open `/docs`; tell me if anything fails (this is the one thing I could not test).
2. Decide **who owns the data source** per astronaut: the engine's simulator (`simulation/start`) **or** your backend via `POST /live/ingest`. Never both for the same astronaut.
3. Store with `EnginePoller` (or port `sqliteStore.js` to your database) and de-duplicate on `emission_id` and `(instance_id, astronaut_id, tick_seq)`.
4. Anything that called `/live/ticks?since_step=` must move to `since_seq` and read `ticks[]` from the object (section 2).
5. n8n Workflow 01: route on `event_type` (`REVIEW_REQUIRED` creates the incident, the other two update it by `event_id`).
6. Send me your database models if you want the mapping in section 3 matched to them exactly.
7. `HEALTH_PUSH_URL` is optional best-effort push; the pull cursors are the reliable path.

## 6. Plugging into the existing backend without touching it (Node + Express + SQLite)

**Do not replace anything.** The engine side only adds tables with the prefix `engine_` (`engine_ticks`, `engine_events`, `engine_reports`, `engine_cursors`) and an HTTP client.

1. **Separate database file.** `new SqliteStore('./engine.db')` creates its own file. Your existing database, its data and its journal mode are never opened or modified. (`SqliteStore` sets `journal_mode=WAL` on the file it opens; if you do point it at your existing file, pass `{ wal: false }` to leave the journal mode alone, and take a backup first.) Moving the tables into your own file later is possible: the DDL is `DDL` in `sqliteStore.js`, no foreign keys to your tables.
2. **Everything is stored unchanged.** The full JSON of every tick, event and report is in `payload`; the other columns are copies for filtering. A new engine field can never be lost.
3. **No duplicates.** Events: `emission_id` is the PRIMARY KEY (`INSERT OR IGNORE`). Ticks: `(instance_id, astronaut_id, tick_seq)`. Reports: `(astronaut_id, latest_reading_at)`.
4. **Cursors are saved in the same transaction as the page** (`saveTicks`, `saveEvents`: one `BEGIN IMMEDIATE ... COMMIT`). A crash cannot lose or repeat a page.
5. **Incidents (your Incident Upsert / Medical Review Lifecycle / WF03 stay as they are).** The engine gives you messages; your existing logic keeps deciding what to do with them:

| Engine message (`event_type`) | `event_id` | What your existing code does |
|---|---|---|
| `HEALTH_REVIEW_REQUIRED` | incident key | call your existing incident upsert with `event_id` as the external key (creates the incident, status from `event.status`) |
| `HEALTH_EVENT_ESCALATED` | same key | call the same upsert / update for that key (severity, `peak_zscore`, `duration_minutes` changed) |
| `HEALTH_EVENT_RESOLVED` | same key | call your existing resolve path for that key |

   Order messages of one incident by `sequence`. Only messages that are **new** (not seen by `emission_id`) reach `onNewEvents`.
   Use `event.needs_human_review`, `event.vitals_involved[].vital` (never the free text) and `data_source` as inputs; the engine never names a disease.
6. **The hook must be durable (known limitation).** The poller saves the page and the cursor first and calls `onNewEvents` afterwards. If your hook throws, those events are
   **stored, but the hook is not called again for them**. I verified this with a fake client. Therefore: (a) make `onNewEvents` only write to your own outbox / queue (cheap and safe),
   or wrap your upsert in try/catch with retry, and (b) make your incident upsert **idempotent by `event_id`**, so that after a crash you can replay everything with
   `store.eventsForIncident(eventId)` or `SELECT payload FROM engine_events ORDER BY sequence` and no incident is created twice. A built-in "dispatched" flag would be a change to `sqliteStore.js` / `poller.js`; it was **not** made (code freeze, ask first).
7. **`gap_detected=true`.** The engine keeps the last 5000 readings per astronaut in memory. If your backend was down longer (about 17 days at 5-minute cadence), the readings in between are gone from the engine: the poller logs a warning and continues from the oldest available reading. Events are not affected by the buffer. Nothing is silently invented: treat a gap as a monitoring-outage period in your UI. After an **engine restart** the instance id changes, the poller re-reads from the start under the new `instance_id`, and replayed incidents keep their `emission_id` (ignored as duplicates).
8. **Data source ownership.** Per astronaut either the engine's simulator or your backend (`POST /api/v1/live/ingest`) produces readings, never both. **The engine does not enforce this** (see `TEST_REPORT_FINAL.md`, known issues).
