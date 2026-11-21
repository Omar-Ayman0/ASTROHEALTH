# Changelog

## 2026-11-21: deployment-ready revision

**Automation**
- Workflows 01-05 refreshed from the running n8n instance: in 01 an invalid `run` / `sequence` / `anomaly_score` now becomes `null` instead of `0`, simplified tool input schema in 02, JSON-stringified save body and tolerant job parsing in 05 and Gemini model `models/gemini-3.5-flash-lite` in 05.
- Exports sanitized: inactive, no credential ids, workflow ids, instance ids, error-workflow reference or Railway URLs. Backend URL defaults to `http://host.docker.internal:4000`.
- New `scripts/configure-workflows.js` points all exports at any backend URL in one command.

**Backend**
- Fails fast with a clear message when `SESSION_SECRET` is missing.
- `COOKIE_SECURE` / `COOKIE_SAMESITE` overrides (defaults unchanged), `DB_PATH` for the SQLite file, `SEED_PASSWORD` for demo accounts (default unchanged), production warning when the default is used.
- `HEALTH_ENGINE_URL` fallback in `routes/api.js` aligned to port 8000 (was 8001, inconsistent with the worker and launcher).
- Legacy ML stream errors logged at most once per minute instead of every 2 seconds.
- Complete `.env.example` (was a single line).

**Engine (evaluation and tests only)**
- Timezone-naive vs aware comparison fixed in `engine/evaluation.py` and `tests/test_live.py`: 39/39 tests pass (was 35/39). No change to detector, baseline, validator, live system, JSON contract or `schema_version`.

**Frontend**
- `vite.config.js` no longer hardcodes a tunnel host; use `VITE_ALLOWED_HOSTS`. Added `frontend/.env.example`.
- Removed the stale nested copy `frontend/frontend/` (older versions of AlertsWidget, WorkflowCenter and DoctorDashboard).

**Repository**
- Removed three outdated workflow exports from the repository root (superseded by `automation/workflows/`).
- Replaced the legacy `docker-compose.yml` (targeted `ml_service`, no engine, no secrets) with an engine + backend + frontend stack, added Dockerfiles (not built by the authors).
- New root `README.md`, `docs/DEPLOYMENT.md`, `deploy/nginx.conf.example`, root CI workflow.

**Known gaps**
- n8n webhooks WF01-WF03 and the engine API are unauthenticated; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Engine v4.1.1 remains a reference, not the active engine.
