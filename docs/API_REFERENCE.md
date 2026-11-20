# API reference

Engine base: `http://127.0.0.1:8000`; interactive OpenAPI at `/docs`. Backend base: `http://localhost:4000`; supplied [OpenAPI](../backend/openapi.json) may lag implementation; [routes](../backend/routes/api.js) are authoritative.

Integration endpoints under `/api/v1` require `x-api-key`.

- `POST /api/simulation/trigger-anomaly`
- `POST /api/emergency/send`
- `POST /api/precaution/send`
- `GET /api/messages/history`
- `POST /api/emergency/resolve`
- `GET /api/vitals/history`
- `GET /api/tasks`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `GET /api/v1/report`
- `GET /api/v1/events`
- `POST /api/doctor/workflows/wf01/test`
- `POST /api/v1/incidents/upsert`
- `GET /api/v1/incidents`
- `POST /api/v1/incidents/:incident_id/actions`
- `POST /api/v1/health-assistant`
- `GET /api/v1/mission/connection`
- `POST /api/doctor/health-assistant`
- `GET /api/doctor/incidents`
- `POST /api/doctor/incidents/:incident_id/actions`

Engine endpoints: `/health`, `/api/v1/astronauts`, `/api/v1/report`, `/api/v1/events`, `/api/v1/events/feed`, `/api/v1/live/ticks`, `/api/v1/live/ingest`, `/api/v1/simulation/start`, `/stop`, `/reset`, `/status` (under simulation). See [contract](../astronaut-health-intelligence/docs/JSON_CONTRACT.md).

Fixtures in `backend/fixtures` are supplied examples, including proposed contracts, not all verified responses.
