# Automation

Import JSONs from [workflows](../automation/workflows). Exports are inactive and credential IDs have been removed. Rebind the HTTP Header Auth credential with `x-api-key` matching backend `.env`; rebind Gemini in WF02. Replace `http://host.docker.internal:4000` with a reachable backend URL (use `http://127.0.0.1:4000` for native n8n; Linux Docker may require host-gateway configuration). Activate WF01–03 only after configuring webhook authentication; WF04 is manual. Set the three webhook URLs in backend `.env` to the production URLs displayed by n8n.

| Workflow | Contract |
| --- | --- |
| 01 | POST health-alert; validates schema 1.0 and HEALTH_REVIEW_REQUIRED, event and emission identity; calls incident upsert; returns correlated ACK |
| 02 | POST health-assistant; HEALTH_BRIEFING or QUESTION; get_health_report and get_review_events; structured output and evidence checks; optional online Gemini |
| 03 | POST incident-review; ACKNOWLEDGE, START_REVIEW, COMPLETE_REVIEW; checks identity, action, previous/new state and persistence |
| 04 | Manual GET mission connection; read-only snapshot; no delivery or retry ownership |

WF04 API tested locally according to supplied sticky note; n8n integration pending. Exports contain no inbound webhook authentication configuration: configure before external exposure. Backend doctor routes also require hardening.
