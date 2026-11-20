# Live demo script (reproducible - nothing is pre-written)

Everything below runs the real engine on each reading at the moment you call it.

**Setup (before the committee):** `python main_pipeline.py` once, then `uvicorn api_server:app --port 8000`.
For the full multi-astronaut flow: `POST /api/v1/simulation/start?interval_seconds=1&start_step=760` and watch `GET /api/v1/astronauts` and `GET /api/v1/events/feed` (see `docs/INTEGRATION.md`). The steps below use single-astronaut manual ticks.
Keep `outputs/charts/ASTRO_01_baseline_vs_observed.png` open as the backup.

1. **Stable readings + baseline.** `GET /api/v1/report?astronaut_id=ASTRO_04` (control astronaut). Show `baseline.metrics.heart_rate_bpm`: `mean`, `std` (1.85 bpm), `raw_std` (5.4 bpm), `circadian_peak_hour`, `sleep_effect`.
   Say: "the same 80 bpm means something different at 03:00 and at 15:00; sigma is 3x smaller once the 24 h rhythm is removed."
2. **Start the live stream just before an event.** `POST /api/v1/simulate/reset?astronaut_id=ASTRO_01&start_step=760`.
3. **Call `GET /api/v1/simulate/next?astronaut_id=ASTRO_01` repeatedly** (about 20 times; the acute event starts at step 780).
   Point at `zscores`, `expected_now`, `intelligence.explanation`, `trigger_alert`.
4. **Explain the alert**: when (`timestamp`), compared with what (`expected_now` = this astronaut at this time of day), which vitals (`explanation`), is the data trusted (`data_quality`), limits (`consecutive_flagged >= 3` or |z| >= 4).
5. **Incident for n8n.** `GET /api/v1/events?astronaut_id=ASTRO_01&review_only=true` -> `events[]` is what Omar turns into an Incident.
6. **Gradual drift (hours, not minutes).** `reset?start_step=880`, call `next` ~60 times, or show `outputs/charts/ASTRO_01_baseline_vs_observed.png` (drift at 14 Nov afternoon) and the `SUSTAINED_DRIFT` event.
7. **Exercise is not an alarm.** `reset?start_step=830`, call `next` ~25 times: HR rises to ~95 bpm around step 840-857 and `intelligence.context` says `PLANNED_ACTIVITY`, no alert.
8. **Sensor fault.** `reset?start_step=695`, call `next` ~12 times: steps 700-705 show `is_corrupted: true`; the reading is excluded, never imputed.
9. **Limits slide** (say it first): synthetic data, same team wrote generator and detector, false-alarm rate 0.2-0.7 per astronaut-day, no clinical claim.

Re-running gives identical numbers (fixed seeds). `demo_only_scenario_label` in a tick is the simulator's label for you to narrate; the engine never reads it.
