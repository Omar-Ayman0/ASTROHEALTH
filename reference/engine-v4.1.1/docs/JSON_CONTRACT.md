# JSON Contract (schema_version 1.0)

One report per astronaut. Produced by `HealthEngine.analyze(...)["report"]`, by
`analyze_health(data, baseline)` and served by `GET /api/v1/report?astronaut_id=ASTRO_01`.
A working example is `outputs/sample_analysis.json` (a mid-drift snapshot, status `REVIEW_REQUIRED`).
`engine/contract.py::validate_report()` checks this contract and the pipeline refuses to write a file that violates it.

> Experimental research prototype. Not a medical device. `anomaly_score` is a deviation scale, **not** a probability of illness.

## Who reads what

| Consumer | Needs | Fields |
|---|---|---|
| Abdelrahman (Backend) | one call, one object | `analyze_health()` / `GET /api/v1/report`, `POST /api/v1/analyze` |
| Omar (n8n incidents) | what happened, why, review needed, trust in data | `events[]`, `active_event`, `status`, `needs_human_review`, `data_source`, `data_quality`; endpoint `GET /api/v1/events?review_only=true` |
| Ahmed (Dashboard) | baseline vs current, trend, score, history, quality, explanation | `baseline`, `observed`, `trend_analysis`, `anomaly_score`, `summary_metrics` + `events`, `data_quality`, `reason` |

## Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | string | `"1.0"`. Bump on any breaking change. |
| `astronaut_id` | string | |
| `generated_at` | ISO string (UTC) | |
| `model_version` | string | `hybrid-v2.1` (statistical + trend + Isolation Forest) or `rules-v2.0` (rules only, rebuilt from a stored baseline). |
| `disclaimer` | string | Show it in the UI. |
| `latest_reading_at` | string | Timestamp of the newest reading analysed (moves with every reading in live mode). |
| `status` | enum | `NOMINAL`, `MONITOR_CLOSELY`, `REVIEW_REQUIRED`, `INSUFFICIENT_DATA` (see below). Reflects the **last 3 h**, not the whole history. |
| `severity` | enum | Severity of the active incident: `NONE`, `LOW_DEVIATION`, `MODERATE_DEVIATION`, `HIGH_REVIEW_PRIORITY`. |
| `needs_human_review` | bool | `true` exactly when `status == REVIEW_REQUIRED`. |
| `anomaly_score` | 0..1 | Max over the last 3 h. `min(1, deviation/6)`, deviation = max(latest-reading z, 1 h rolling-mean z) in units of the astronaut's own sigma. 0.5 = 3 sigma, 0.67 = 4 sigma. |
| `anomaly_score_definition` | string | The definition above, for the UI tooltip. |
| `reason` | string | Human-readable cause. |
| `key_findings` | list of strings | Short, number-based findings (reason, vitals involved with observed vs expected, review reason, trends, sleep, data quality). Written for the AI assistant: it should not need to guess. |
| `latest_event_id` | string or null | Id of the most recent review-level incident. |
| `latest_vitals` | object | Newest reading: `timestamp`, `activity_state`, `is_corrupted`, and per vital `value`, `expected`, `zscore` (null if invalid or masked by planned activity). |
| `live` | object | Only in live reports: `run`, `step_index`, `data_quality_window`. |
| `data_source` | object | `type`, `is_real_astronaut_data` (always `false` in this prototype), `engine_reads_ground_truth_columns` (`false`). |
| `data_quality` | object | See below. |
| `baseline` | object | Personal baseline, see below. |
| `observed` | object | Last 3 h per vital: `window_mean`, `expected_window_mean`, `window_mean_zscore`, `latest_value`, `expected_now`, `latest_timestamp`. This is "Baseline vs Current". |
| `trend_analysis` | list | Per vital: slope (per hour) of `value - expected` over the last 3 h, `direction` (`STABLE`/`INCREASING`/`DECREASING`/`UNKNOWN`), `status` (`NOMINAL`/`DRIFT_WARNING`/`INSUFFICIENT_DATA`) and the threshold used. |
| `sleep` | object | Nightly sleep vs personal baseline: `status` (`NOMINAL`, `SHORT_SLEEP_WATCH`, `SLEEP_RESTRICTION_TREND`, `INSUFFICIENT_DATA`), `baseline_hours`, `nights[]`. |
| `active_event` | object or null | The incident overlapping the last 3 h, if any (same shape as `events[]`). |
| `events` | list | Incidents (last 25, **LOW_DEVIATION noise events hidden**, their count is in `summary_metrics.low_deviation_events_hidden`). |
| `summary_metrics` | object | Row/flag/event counts for the analysed period. |

### `status` rules (last 3 h = 36 readings)
1. stream unusable (more than 6 consecutive invalid readings now, or more than 25 % of the last 3 h invalid) -> `INSUFFICIENT_DATA` (no health conclusion is drawn);
2. at least one alert (>= 3 consecutive flagged readings, or a single reading beyond 4 sigma) -> `REVIEW_REQUIRED`;
3. at least 2 flagged readings, or a sleep restriction trend -> `MONITOR_CLOSELY`;
4. otherwise `NOMINAL` (a single isolated 3-sigma reading is treated as noise).

### `data_quality`
`total_records`, `corrupted_records`, `missing_values_detected`, `out_of_bounds_detected`, `flatline_detected`,
`longest_invalid_run_steps`, `current_invalid_run_steps`, `recent_invalid_fraction`, `data_quality_score_pct`,
`status` (`HEALTHY_STREAM` >= 95 %, `DEGRADED_STREAM`, `INSUFFICIENT_DATA`).
Invalid readings are **never imputed**; they are excluded from analysis.

### `baseline`
`astronaut_id`, `calibration_samples`, `calibration_hours`, `calibration_ends`, `use_circadian`,
`trend_thresholds` (per vital, learned from the astronaut's own calibration noise), `sleep_baseline_hours`,
and `metrics[vital]`:

| Field | Meaning |
|---|---|
| `mean` | Mean level (intercept of the time-of-day model). |
| `std` | **sigma used for z-scores** = residual SD after removing the 24 h rhythm and sleep effect. |
| `raw_std` | Total SD of the calibration data (what v1 used as sigma). |
| `model` | `circadian` or `flat` (flat when calibration < 18 h or the rhythm explains < 10 % of variance). |
| `circadian_amplitude`, `circadian_peak_hour`, `sleep_effect`, `variance_explained` | Learned shape of the astronaut's day. |
| `normal_min`, `normal_max` | Envelope of the expected curve +/- 2 sigma (display only). |
| `median`, `iqr` | Descriptive. |
| `coef` | `[intercept, sin24h, cos24h, sleep]` - lets the backend rebuild the baseline. |

## `events[]` (one per incident, for n8n)

`event_id` (stable: `<astronaut>-EV-<start time>`, suffix `-r2`.. after a simulation reset), `astronaut_id`, `type` (`ACUTE_DEVIATION` < 3 h, `SUSTAINED_DRIFT` >= 3 h), `severity`
(`HIGH_REVIEW_PRIORITY`, `MODERATE_DEVIATION`, `LOW_DEVIATION`), `needs_human_review`, `start`, `end`,
`duration_minutes`, `flagged_readings`, `peak_zscore`, `anomaly_score`, `status` (`OPEN`/`RESOLVED`, live only), `review_reason`,
`triggered_by` `{stat, trend, ml}`, `vitals_involved[]` (`vital`, `direction`, `peak_zscore`, `mean_zscore`,
`observed_mean`, `expected_mean`, `baseline_sigma`), `explanation`, `scenario_context_demo_only`
(simulator label, **demo only**, never used by the engine; ignore it in production).

`needs_human_review` is `true` when the event has >= 3 flagged readings or `anomaly_score >= 0.67`.

## Live system and event messages

Continuous multi-astronaut operation, the event envelope (`HEALTH_REVIEW_REQUIRED` / `ESCALATED` / `RESOLVED`), the feed and the
offline behaviour are described in [`INTEGRATION.md`](INTEGRATION.md).

## Single live tick: `GET /api/v1/simulate/next?astronaut_id=ASTRO_01`

Each call feeds the next simulator reading to the engine and analyses it at that moment.
Returns `tick_seq` (pull cursor, never goes back), `run`, `step_index` (replay position, goes back after a reset), `timestamp`, `vitals`, `expected_now`, `zscores`, `activity_state`, `data_quality`,
`intelligence` (`hybrid_anomaly`, `stat_anomaly`, `ml_anomaly`, `trend_drift`, `max_zscore`, `anomaly_score`,
`context`, `consecutive_flagged`, `explanation`), `trigger_alert` (alias `trigger_n8n_alert`),
`demo_only_scenario_label`, `progress`, `finished`.
`trigger_alert` is true when the reading is flagged **and** (it is the 3rd consecutive flagged reading, or |z| >= 4).

## Other endpoints

| Endpoint | Use |
|---|---|
| `GET /api/v1/astronauts` | list with current status/score |
| `GET /api/v1/events?astronaut_id=&review_only=true` | incidents for n8n |
| `GET /api/v1/live/ticks?astronaut_id=&since_seq=&limit=&engine_instance_id=` | readings to persist: `{astronaut_id, engine_instance_id, instance_changed, run, last_tick_seq, next_since_seq, has_more, count, gap_detected, ticks[]}`; cursor = `next_since_seq` |
| `GET /api/v1/events/feed?since_seq=&limit=&engine_instance_id=` | event messages: `{engine_instance_id, instance_changed, last_sequence, next_since_seq, has_more, events[]}`; cursor = `next_since_seq`, **not** `last_sequence` |
| `POST /api/v1/analyze` | analyse a window (>= 12 readings, post-calibration) with the astronaut's stored baseline + Isolation Forest |
| `POST /api/v1/evaluate-instant` | one reading vs the baseline (send `timestamp` and `activity_state` to get the time-of-day baseline; no trend/ML) |
| `POST /api/v1/simulate/reset?astronaut_id=&start_step=` | restart the live replay (e.g. `start_step=760` to start just before the acute event) |

## Migration from v1

| v1 | v2 |
|---|---|
| `overall_health_status` (`ATTENTION_REQUIRED`...) | `status` (`REVIEW_REQUIRED`, `MONITOR_CLOSELY`, `NOMINAL`, `INSUFFICIENT_DATA`) |
| `personal_baseline` | `baseline.metrics` (same keys `mean,std,median,iqr,normal_min,normal_max` + new ones). **`std` now means residual sigma.** |
| `recent_anomalies` | `events` + `active_event` |
| `GET /api/v1/report?recompute=` | `GET /api/v1/report?astronaut_id=` (no recompute; the engine is fitted at startup) |
| `trigger_n8n_alert` | still present as an alias of `trigger_alert` |
| single astronaut | `ASTRO_01..04` (demo) |
