# Automation — n8n Integration

ASTROHEALTH uses n8n for event orchestration and AI-assisted workflows while the Node.js backend remains the source of truth for incident records, medical-review state, triage jobs, and escalation timers. Import workflow JSON files from [`../automation/workflows/`](../automation/workflows/). The exports are intentionally inactive.

## Workflow contracts

| Workflow | Trigger | Backend interaction | Behavior / boundary |
| --- | --- | --- | --- |
| **01 — Health Alert Orchestrator** | Webhook | `POST /api/v1/incidents/upsert` | Validates the incoming schema/event identity, registers or updates the incident, and returns a correlated acknowledgement. `HEALTH_REVIEW_REQUIRED` events create the backend WF05 triage/escalation records. |
| **02 — AI Health Assistant** | Webhook | `GET /api/v1/report`, `GET /api/v1/events` | Accepts the supported health-assistant request types, grounds the response in backend report/event evidence, and validates structured output. Gemini requires a configured credential. |
| **03 — Incident Review & Acknowledgment** | Webhook | `POST /api/v1/incidents/:incident_id/actions` | Supports `ACKNOWLEDGE`, `START_REVIEW`, and `COMPLETE_REVIEW`; validates identity, requested action, previous/new status, timestamp, and `persisted=true`. |
| **04 — Mission Connection Monitor** | Manual | `GET /api/v1/mission/connection` | Produces a read-only status snapshot. Backend retains ownership of dispatch, retries, and acknowledgements. |
| **05 — Smart Triage & Escalation Watcher** | Schedule: every 60 seconds | `GET /api/v1/triage/due`; `GET /api/v1/incidents/:incident_id/triage-context`; `POST /api/v1/incidents/:incident_id/triage-brief`; `GET /api/v1/escalations/due`; `POST /api/v1/escalations/:id/advance` | Generates a concise AI triage brief from the incident and available engine evidence, falls back to a deterministic metadata-based brief if AI output is unavailable/invalid, saves through backend validation, and advances due escalation records using a stable request ID. |

## WF05 — Smart Triage & Escalation Watcher

### Triage path

1. Poll `GET /api/v1/triage/due` for jobs with `PENDING` or `FAILED` status.
2. Load the incident context from `GET /api/v1/incidents/:incident_id/triage-context`. The backend context includes the incident, original event payload, engine report, engine events, and the allowed `evidence_refs` list.
3. Ask Gemini for a structured brief. The prompt restricts the model to the supplied context, prohibits diagnosis/treatment claims, and requires exact evidence-reference reuse.
4. Validate the generated shape in n8n. If it is invalid, use a deterministic fallback based on stored incident metadata and available evidence references.
5. Save the brief with `POST /api/v1/incidents/:incident_id/triage-brief`. The backend independently validates required fields, array types, confidence range, incident existence, and that every evidence reference belongs to the incident context. It stores the brief and marks the triage job `COMPLETED` (or `FALLBACK`).

### Escalation path

1. Poll `GET /api/v1/escalations/due` for active escalation records whose `due_at` has passed.
2. Build an escalation/reminder payload for downstream presentation and call `POST /api/v1/escalations/:id/advance`.
3. Use a deterministic `request_id` based on escalation ID and stage. The backend checks the request ID for idempotency and advances `REMINDER_1` to `ESCALATED`, then completes the escalation on the subsequent due stage.
4. The backend owns durable due times and cancellation. A doctor acknowledgement can cancel the active escalation through the backend incident-review path.

**Notification limitation:** the current WF05 creates a notification data object for context but does not send an email, SMS, push message, or other doctor-facing notification. It advances the backend escalation state only. Do not describe it as a notification-delivery workflow unless a delivery integration is added and tested.

**Clinical safety:** WF05 creates an AI-generated summary for human medical review. It is not a diagnosis, treatment recommendation, or replacement for the health engine or medical officer. The backend evidence-reference validation is an additional integrity check, not clinical validation.

## Credentials and connectivity

- **Backend credential:** create/select the n8n HTTP Header Auth credential named `ASTROHEALTH Backend Auth`. Header name: `x-api-key`; value: the same secret configured as `API_KEY` in `backend/.env`. Do not commit the secret.
- **Gemini credential:** configure the Google Gemini credential for WF02 and WF05. WF05 is configured for `models/gemini-3.1-flash-lite`; availability depends on the Google API account/model access.
- **Backend URL:** exports use `http://host.docker.internal:4000`. Use `http://127.0.0.1:4000` when n8n runs directly on the same host, or a reachable deployed backend URL. In Linux Docker, configure host-gateway access if required. Update every HTTP Request node consistently.
- **Webhook security:** configure authentication/authorization for inbound n8n webhooks before public exposure. Configure the backend's health-alert webhook URL environment variable to the production webhook URL shown by n8n. Keep service secrets on the server side.
- **Activation:** WF01–WF03 require webhook configuration and end-to-end testing. WF04 is manual. WF05 is scheduled and should remain inactive until backend connectivity, credentials, Gemini behavior, fallback behavior, and escalation idempotency have been tested.

## Operational checks

- Test with a dedicated test incident; verify the triage brief appears in the backend/UI and that the triage job is marked complete.
- Test with Gemini unavailable and with malformed model output; confirm the fallback brief is saved.
- Test invalid/unknown evidence references directly against the backend and confirm rejection.
- Test `REMINDER_1` and `ESCALATED` progression, repeated request IDs, doctor acknowledgement/cancellation, and backend downtime.
- Inspect n8n execution history and backend logs. Do not assume a workflow is production-ready solely because its JSON imports successfully.

## Current integration status

The repository contains the WF05 backend endpoints and the n8n workflow export. This documentation describes the intended integration contract; it does not claim that the workflow has been imported, credentialed, or end-to-end tested in a live n8n instance. WF04's workflow note reports local API testing with n8n integration pending. Verify all workflows in the target environment before activation.
