# Test report

> **Final delivery numbers (28 + 20 + 7 tests, measured after unpacking the zip) are in [`TEST_REPORT_FINAL.md`](TEST_REPORT_FINAL.md).** The text below is the v2.0 report and is kept for history.

Python 3.13.18, pytest 9.1.1, Linux. Command: `python -m pytest -v tests` on a clean copy of the delivered files.
**Result: 43 passed, 0 failed/skipped, total 295 s.**

Not covered by pytest (reported separately in `NODE_INTEGRATION.md`): `api_server.py` with real FastAPI (not run), Node tests (7/7), HTTP smoke test (19/19 on the stdlib test server).

| File | Test | Time (s) | Result |
|---|---|---|---|
| test_engine | `test_generator_is_deterministic_and_has_seven_astronauts` | 0.1 | PASSED |
| test_engine | `test_astronauts_have_different_baselines` | 0.9 | PASSED |
| test_engine | `test_validator_catches_artifacts_without_imputing_or_false_alarms` | 0.0 | PASSED |
| test_engine | `test_validator_reasons_accumulate` | 0.0 | PASSED |
| test_engine | `test_long_gap_means_insufficient_data_not_a_health_conclusion` | 0.1 | PASSED |
| test_engine | `test_circadian_baseline_shrinks_sigma_and_learns_sleep_effect` | 0.0 | PASSED |
| test_engine | `test_baseline_falls_back_to_flat_on_short_calibration` | 0.1 | PASSED |
| test_engine | `test_baseline_refuses_to_fit_without_valid_data` | 0.0 | PASSED |
| test_engine | `test_exercise_is_not_flagged` | 0.0 | PASSED |
| test_engine | `test_all_injected_events_detected_on_every_astronaut_with_bounded_latency` | 0.8 | PASSED |
| test_engine | `test_blind_astronauts_all_injected_events_detected` | 0.5 | PASSED |
| test_engine | `test_control_astronaut_has_no_high_priority_event` | 0.2 | PASSED |
| test_engine | `test_sensor_artifact_rows_are_never_flagged_as_anomalies` | 0.0 | PASSED |
| test_engine | `test_acute_event_explanation_names_the_vitals_and_time_of_day_baseline` | 0.0 | PASSED |
| test_engine | `test_drift_is_classified_as_sustained` | 0.0 | PASSED |
| test_engine | `test_isolation_forest_alone_never_creates_a_hybrid_flag` | 0.0 | PASSED |
| test_engine | `test_sleep_restriction_detected_and_control_not_flagged` | 0.0 | PASSED |
| test_engine | `test_streaming_equals_batch_and_ignores_ground_truth` | 8.3 | PASSED |
| test_engine | `test_engine_output_does_not_depend_on_ground_truth_columns` | 0.2 | PASSED |
| test_engine | `test_reports_follow_the_contract_and_are_strict_json` | 0.0 | PASSED |
| test_engine | `test_analyze_health_rules_only_from_stored_baseline` | 0.1 | PASSED |
| test_engine | `test_evaluate_instant_uses_time_of_day_and_excludes_invalid_vitals` | 0.0 | PASSED |
| test_engine | `test_api_schemas_import_when_pydantic_is_installed` | 0.1 | PASSED |
| test_live | `test_report_is_rebuilt_on_every_reading` | 0.5 | PASSED |
| test_live | `test_astronauts_are_independent` | 2.2 | PASSED |
| test_live | `test_one_incident_gives_one_review_event` | 29.4 | PASSED |
| test_live | `test_event_envelope_matches_the_agreed_contract` | 0.0 | PASSED |
| test_live | `test_live_events_equal_batch_events` | 0.2 | PASSED |
| test_live | `test_feed_is_ordered_and_replayable` | 0.0 | PASSED |
| test_live | `test_events_are_logged_locally_for_offline_use` | 0.0 | PASSED |
| test_live | `test_report_links_the_latest_event_and_explains_it` | 2.1 | PASSED |
| test_live | `test_background_simulation_runs_all_astronauts_and_stops` | 2.8 | PASSED |
| test_live | `test_external_ingest_works_like_the_simulator` | 0.3 | PASSED |
| test_live | `test_reset_starts_a_new_run_with_new_event_ids_only_if_data_was_produced` | 3.6 | PASSED |
| test_live | `test_ticks_cursor_survives_reset` | 2.9 | PASSED |
| test_live | `test_ticks_paging_with_limit_no_loss_no_dup` | 1.7 | PASSED |
| test_live | `test_ticks_detect_engine_restart` | 0.9 | PASSED |
| test_live | `test_feed_cursor_with_limit_loses_nothing` | 18.9 | PASSED |
| test_live | `test_feed_cursor_with_filter` | 19.3 | PASSED |
| test_live | `test_feed_detects_engine_restart` | 4.0 | PASSED |
| test_live | `test_six_astronauts_are_fully_independent` | 193.7 | PASSED |
| test_live | `test_six_astronauts_feed_is_global_ordered_and_per_astronaut_filterable` | 0.0 | PASSED |
| test_live | `test_resetting_one_astronaut_leaves_the_other_five_untouched` | 0.1 | PASSED |


## v2.1 re-run
engine tests 28/28, live tests 20/20, Node 7/7 (all passing after the v2.1 scientific audit; see docs/CHANGES.md). Earlier counts above are from v2.0.
