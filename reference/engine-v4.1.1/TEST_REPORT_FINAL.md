# Final test report: ASTROHEALTH Engine v4.1.1 (backend handoff)

Engine `hybrid-v2.1`, schema `1.0`. Measured **after unpacking `astrohealth-engine-backend-v4.1.1.zip` into an empty folder** and running from there (no file from outside the package).
Environment: Linux, Python 3.13.18, Node 22.23.4, packages from `requirements-tested-py313.txt` (numpy 2.5.3, pandas 3.0.5, scikit-learn 1.9.1, scipy 1.18.1, matplotlib 3.11.2, pydantic 2.13.5, pytest 9.1.1, uvicorn 0.54.0). **Not Windows. FastAPI not installed.**

## Results

| Suite | Command | Result |
|---|---|---|
| Python engine + live tests | `python -m pytest -q tests/test_engine.py tests/test_live.py -rs` | **48 passed, 0 failed, 0 skipped** (7 min 10 s). 28 in `test_engine.py` + 20 in `test_live.py` |
| Node integration | `cd integration/node && npm test` | **7 passed, 0 failed, 0 skipped** (about 2 min) |
| HTTP smoke test (6 astronauts) against `tests/stdlib_shim_server.py` | `python tests/smoke_api.py http://127.0.0.1:8821 --astronauts 6` | **19/19 passed** |
| `api_server.py` handlers executed with a **stand-in for `fastapi`** | author's script, not included | 19/19 passed. **This is not a FastAPI / Uvicorn run.** |
| Node test with only `python` on PATH (no `python3`) | `node --test test/poller.test.js` | passed (simulates the Windows situation) |
| Node test with no Python / no `tests/` folder | same | fails with a readable message ("No usable Python >= 3.12 found ..." / "test server not found ...") |

The earlier figure "43 passed" counted the v2.0 suite (23 + 20); the suite is now 28 + 20 = 48 (5 tests were added for the v2.1 scientific audit). Nothing was skipped.

### Which test covers which of the requested areas
| Area | Tests |
|---|---|
| Baseline | `test_circadian_baseline_*`, `test_baseline_falls_back_to_flat_on_short_calibration`, `test_baseline_refuses_to_fit_without_valid_data`, `test_astronauts_have_different_baselines` |
| Trend detection | `test_drift_is_classified_as_sustained`, `test_trend_detector_covers_all_five_vitals_and_sees_a_spo2_drift` |
| Event generation | `test_one_incident_gives_one_review_event`, `test_live_events_equal_batch_events`, `test_event_envelope_matches_the_agreed_contract`, `test_all_injected_events_detected_*`, `test_blind_astronauts_*` |
| Data validation | `test_validator_*`, `test_long_gap_means_insufficient_data_*`, `test_sensor_artifact_rows_are_never_flagged_*` |
| JSON contract | `test_reports_follow_the_contract_and_are_strict_json`, `test_event_envelope_matches_the_agreed_contract` |
| Six astronauts / reset | `test_six_astronauts_are_fully_independent`, `test_six_astronauts_feed_*`, `test_resetting_one_astronaut_leaves_the_other_five_untouched`, `test_astronauts_are_independent` |
| Cursors | `test_ticks_cursor_survives_reset`, `test_ticks_paging_with_limit_no_loss_no_dup`, `test_ticks_detect_engine_restart`, `test_feed_cursor_*`, `test_feed_detects_engine_restart` |
| Node (7 subtests) | ticks paging with limit 7 / no repeat, reset, events paging + lossless JSON + `emission_id` uniqueness, reports unchanged, engine down (cursor untouched), engine restart (new `engine_instance_id`) |

## Point by point against the request

| # | Request | Status |
|---|---|---|
| 1 | Missing `tests/` | Fixed: full `tests/` folder in the zip; Node test gives a clear error and accepts `ENGINE_SHIM`; `npm test` verified from an empty folder |
| 2 | `python3` on Windows, Python versions | Fixed in the Node test (probes `PYTHON`, `python3`/`python`/`py -3`, needs >= 3.12). **Python 3.12 / 3.14 not run, Windows not run**: see `WINDOWS_SETUP.md` section 0 |
| 3 | Requirements | Explained in `WINDOWS_SETUP.md` section 0. **No version changed.** FastAPI is not in the tested file and its combination with the other pins is **untested** |
| 4 | Real FastAPI | **NOT DONE.** No network here, FastAPI cannot be installed. Replaced by the stand-in run above (not equivalent). Steps for you: `WINDOWS_SETUP.md` section 4 |
| 5 | Python tests in a clean unpack | Done: 48/48 |
| 6 | Node tests | Done on Linux: 7/7. Windows not run |
| 7 | Poller and cursors | Reviewed and covered by the tests above. Confirmed: `since_seq`, `ticks[]` / `next_since_seq` / `has_more`, `next_since_seq` for the feed, `engine_instance_id` change detection, `emission_id` and `(instance_id, astronaut_id, tick_seq)` dedupe. `gap_detected`: `NODE_INTEGRATION.md` section 6.7. **One known limitation: see K1** |
| 8 | Node package | All 7 files present; `engines.node` is `>=22.13`. Express router **syntax-checked only** (Express not installed) |
| 9 | Database integration | `NODE_INTEGRATION.md` section 6: separate `engine.db`, lossless `payload`, dedupe keys, cursor in the same transaction (verified in `sqliteStore.js` and by the tests). I have not seen your incident code: the mapping to your Incident Upsert / WF03 is guidance, **not tested against your backend** |
| 10 | Six astronauts | Tested (see table); `HEALTH_ASTRONAUT_COUNT=6` checked through the `api_server` handlers (stand-in) and the shim |
| 11 | Contract and scientific data | `MODEL_VERSION hybrid-v2.1`, `SCHEMA_VERSION 1.0`; `engine/`, `api_server.py`, `tests/` are byte-identical to the v4.1 delivery. Only `integration/node/{package.json, src/sqliteStore.js, test/poller.test.js}` and documents changed |
| 12 | Data source and safety | Answers below, including two problems (K2, K3) |
| 13 | Documentation | Added `README_BACKEND.md`, `WINDOWS_SETUP.md`, `TEST_REPORT_FINAL.md`, `scripts/windows_verify.ps1`; docs listed in the request are included |
| 14 | Delivery | This zip; "Not tested" and "Known issues" below |

### Item 12, answers
* Data are **synthetic**. Every report and every event carries `data_source: {type: "synthetic_simulator", is_real_astronaut_data: false, engine_reads_ground_truth_columns: false}` (checked on the samples and on a live report). **Ticks do not carry `data_source`** (only the report/event do).
* Real data: `engine/adapter.py` + `data/mapping.example.json` convert a real file to the engine schema offline; the live path is `POST /api/v1/live/ingest`.
* Research prototype, not a medical device, no diagnosis: stated in README, `SCIENTIFIC_FOUNDATION.md`, `signal_definitions.json`.

## Not tested
Real FastAPI/Uvicorn and `/docs`; Express router at runtime; anything on Windows (including `scripts/windows_verify.ps1`); Python 3.12 and 3.14; `fastapi==0.162.4` together with the other pins; integration with your actual backend, incident upsert and WF03; n8n flows; the v2.1 five-vital trend detector on a new blind set; the scientific references (evidence table is as received, some rows are secondary sources).

## Known issues (not fixed, because the request forbids contract / algorithm changes without asking first)

* **K1. The `onNewEvents` hook is not retried.** The poller saves the events and the cursor, then calls the hook. If the hook throws, those events are stored but the hook is never called again for them (verified with a fake client: 2 events stored, hook called once, second poll "ok", no second call). Mitigation: hook only writes to your own outbox, incident upsert idempotent by `event_id`, replay from `engine_events`. Proposed fix: a `dispatched` flag in `engine_events`. **Needs your OK.**
* **K2. No protection against mixing sources.** Nothing stops `POST /live/ingest` and the built-in simulator from feeding the same astronaut; the documents only say "never both". Proposed fix: an explicit per-astronaut source mode with HTTP 409 on conflict. **Needs your OK** (API behaviour change).
* **K3. Real data would be labelled synthetic.** `api_server.py` creates the `LiveSystem` without a `data_source`, so readings pushed through `/live/ingest` are still reported as `synthetic_simulator` / `is_real_astronaut_data: false`. Safe for the demo, wrong once real data flows. Proposed fix: `HEALTH_DATA_SOURCE_TYPE` / `HEALTH_REAL_DATA` environment variables passed to `LiveSystem`. **Needs your OK.** Until then, do not label anything as real data in the UI.
* **K4.** Engine state is in memory: a restart loses the readings buffer (5000 per astronaut) and replays from the start under a new `engine_instance_id`; events are not re-served from `data/live/events.jsonl`. The poller handles the restart (tested), the history is in your `engine.db`.
* **K5.** Timing: `test_live.py` takes about 5 minutes, the Node test about 2. The Node test waits up to 90 s for the Python test server to start; on a slow Windows machine (antivirus scanning numpy / pandas / scikit-learn at the first import) that may not be enough. If so, run the Python server by hand and use `ENGINE_URL` (see `WINDOWS_SETUP.md`).
* **K6.** `npm test` relies on Node's own glob expansion of `test/*.test.js` (Node >= 21), which is why Node >= 22.13 is required; not run on Windows.
