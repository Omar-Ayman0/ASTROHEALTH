# Deployment (VPS)

This guide describes a single-server layout: engine, backend and frontend on one VPS behind a TLS reverse proxy, with n8n on the same host or reachable from it. The process manager is your choice (systemd, pm2, Docker). Parts of this guide were not executed on a server by the authors of this revision; see the checklist at the end.

## 1. Services and ports

| Service | Default port | Exposed to the internet? |
|---|---|---|
| Engine (`uvicorn api_server:app`) | 8000 | Only two read-only GET routes through the proxy |
| Backend (`node server.js`) | 4000 | Through the proxy (`/api`, `/socket.io`) |
| Frontend (static build) | served by the proxy | Yes |
| n8n | 5678 | Webhook paths only, ideally from the backend host only |

## 2. Backend environment

Copy `backend/.env.example` to `backend/.env`. Required: `SESSION_SECRET` (the server exits without it) and `API_KEY`. Important ones:

| Variable | Purpose |
|---|---|
| `FRONTEND_ORIGIN` | Exact browser origin(s), comma-separated. Used for CORS, Socket.IO and cookies |
| `HEALTH_ENGINE_URL` | Engine base URL, normally `http://127.0.0.1:8000` |
| `HEALTH_ALERT_WEBHOOK_URL`, `HEALTH_ASSISTANT_WEBHOOK_URL`, `INCIDENT_REVIEW_WEBHOOK_URL` | n8n **production** webhook URLs (`.../webhook/health-alert`, `/health-assistant`, `/incident-review`) |
| `SEED_PASSWORD` | Password of the demo accounts, read on the **first** start only |
| `NODE_ENV=production` | Secure cookies with `SameSite=None` (needs HTTPS). On plain HTTP set `COOKIE_SECURE=false` and `COOKIE_SAMESITE=lax` |
| `DB_PATH` | SQLite file location (use a persistent path) |

`API_KEY` must equal the value of the n8n credential **ASTROHEALTH Backend Auth** (HTTP Header Auth, header name `x-api-key`).

## 3. Frontend

```bash
cd frontend
VITE_API_URL=https://astrohealth.example.com VITE_ENGINE_URL=https://astrohealth.example.com/engine npm run build
# copy dist/ to the web root used by the proxy
```

`VITE_*` values are compiled into the bundle, so rebuild after changing them.

## 4. Reverse proxy

[`deploy/nginx.conf.example`](../deploy/nginx.conf.example) serves the frontend, proxies `/api` and `/socket.io` to the backend, and exposes only `GET /engine/api/v1/astronauts` and `GET /engine/api/v1/live/ticks` from the engine. Simulation and demo control routes stay internal.

## 5. n8n

1. Generate workflows for your backend and import them: `node scripts/configure-workflows.js https://astrohealth.example.com` (or the internal URL n8n can reach), then import the files from `automation/workflows.configured/`.
2. Create the credentials: **ASTROHEALTH Backend Auth** (Header Auth, `x-api-key` = backend `API_KEY`) and, for WF02/WF05, a Google Gemini credential. Re-select them on every node that shows a missing credential.
3. Activate WF01, WF02, WF03 and WF05 only after a test run. WF04 stays manual.
4. Put the production webhook URLs into the backend `.env` and restart the backend.

## 6. Optional: Docker Compose

```bash
cp .env.example .env     # fill in SESSION_SECRET, API_KEY, SEED_PASSWORD and the public URLs
docker compose up -d --build
```

The compose file starts engine, backend and frontend; n8n is deployed separately. **It has not been built or run by the authors** (no Docker available when it was written), so treat the first build as a test.

## 7. Hardening checklist (do before exposing the server)

- [ ] `SESSION_SECRET` and `API_KEY` are long random values, not shared with other systems.
- [ ] Demo accounts: `SEED_PASSWORD` set before the first start, or passwords changed afterwards.
- [ ] n8n webhooks WF01-WF03 are **not authenticated** in the exports. Restrict them at the network level (firewall / proxy allow-list to the backend host) or add Header Auth to the Webhook nodes and send the same header from the backend.
- [ ] The engine API has permissive CORS and unauthenticated control routes. Bind it to `127.0.0.1` and expose only the two proxied GET routes.
- [ ] HTTPS everywhere; `FRONTEND_ORIGIN` lists only your real origin.
- [ ] SQLite file and `.env` are backed up and not world-readable.
- [ ] No real patient data. This is a synthetic-data prototype.

## 8. Smoke test after deployment

1. `curl http://127.0.0.1:8000/health` returns `ONLINE`.
2. Log in as `doctor`, open an astronaut: live vitals update.
3. Trigger the demo scenario (see [DEMO.md](DEMO.md)); an incident appears, WF01 runs once in n8n and WF05 produces a triage brief.
4. Run `ACKNOWLEDGE` from the dashboard; WF03 reports `persisted=true` and the escalation is cancelled.
