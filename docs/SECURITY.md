# Security

Original `.env`, SQLite state, backups, bundled archives and deployment URLs in workflow nodes were excluded or sanitized. Credential IDs removed; names are labels, not credentials. Rebind credentials after import. Backend integration uses timing-safe key comparison; doctor routes and engine are not protected by equivalent authorization. CORS is permissive, Socket.IO accepts all origins, and n8n inbound webhooks lack explicit authentication. Keep local/trusted network only; add authentication, authorization, TLS, restricted CORS and secrets management before exposure. API keys do not establish reviewer identity. No clinical data should be used.

## Deployment notes (2026-11-21)

The backend now refuses to start without `SESSION_SECRET`, accepts `SEED_PASSWORD` for the demo accounts (default `123456` is for local demos only) and exposes cookie overrides. Exports of the n8n workflows contain no credential ids, instance ids or deployment URLs. Webhook authentication on WF01-WF03 and engine authorization are still **not implemented**; follow the checklist in [DEPLOYMENT.md](DEPLOYMENT.md#7-hardening-checklist-do-before-exposing-the-server).
