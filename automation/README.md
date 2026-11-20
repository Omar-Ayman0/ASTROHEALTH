# ASTROHEALTH — n8n Automation

This directory contains the versioned n8n workflow exports used by ASTROHEALTH. The workflows complement the Node.js backend; they do not replace backend persistence, authorization, or state-transition logic.

## Workflow catalogue

| File | Workflow | Trigger | Responsibility |
| --- | --- | --- | --- |
| [`01-health-alert-orchestrator.json`](workflows/01-health-alert-orchestrator.json) | Health Alert Orchestrator | Webhook | Validates a health-review event, upserts the incident, and returns a correlated acknowledgement. |
| [`02-ai-health-assistant.json`](workflows/02-ai-health-assistant.json) | AI Health Assistant | Webhook | Uses backend report/event evidence to produce a structured health explanation. |
| [`03-incident-review.json`](workflows/03-incident-review.json) | Incident Review & Acknowledgment | Webhook | Applies supported medical-review actions and validates the backend response. |
| [`04-sync-monitoring.json`](workflows/04-sync-monitoring.json) | Mission Connection Monitor | Manual | Reads the backend mission-connection status without taking ownership of sync delivery. |
| [`05-smart-triage-escalation-watcher.json`](workflows/05-smart-triage-escalation-watcher.json) | Smart Triage & Escalation Watcher | Every 60 seconds | Processes due triage jobs, saves an evidence-grounded brief, and advances due escalation timers. |

## Setup

1. Import the required JSON files into n8n. Exports are inactive.
2. Create/select the `ASTROHEALTH Backend Auth` HTTP Header Auth credential and set the header to `x-api-key` with the value of backend `API_KEY`. Assign it to every backend HTTP Request node.
3. For WF02 and WF05, configure the Google Gemini credential. WF05 uses `models/gemini-3.1-flash-lite`.
4. Set backend URLs to an address reachable from the n8n runtime. The checked-in exports use `http://host.docker.internal:4000`; for native n8n use `http://127.0.0.1:4000`, or use the deployed backend URL. Linux Docker may require a host-gateway mapping.
5. Configure and verify webhook authentication for WF01–WF03 before exposing their webhook URLs. Configure the matching backend webhook URL environment variables for the alert dispatch integration.
6. Test with non-production data, then activate only the workflows whose credentials, contracts, and failure paths have been verified. WF04 remains manual; WF05 is scheduled.

Detailed endpoint contracts, operational notes, and limitations are in [`../docs/AUTOMATION.md`](../docs/AUTOMATION.md).
