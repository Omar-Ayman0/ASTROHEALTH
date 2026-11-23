# ASTROHEALTH Frontend

React 19 + Vite dashboards for the ASTROHEALTH mission-control stack.

| Route | Role | Purpose |
|---|---|---|
| `/login` | all | Session login |
| `/` | admin | Workspace selection |
| `/astronaut/:id` | astronaut, admin | Live vitals, hologram, tasks, AI assistant |
| `/doctor` | doctor, admin | Analytics, history, incidents, workflow center |

```bash
npm install
cp .env.example .env     # optional: set VITE_API_URL / VITE_ENGINE_URL
npm run dev              # http://localhost:5173
npm run build            # production bundle in dist/
npm run lint
```

Backend and engine URLs are resolved in `src/config.js`. `VITE_*` values are compiled in, so rebuild after changing them.
Optional 3D astronaut model: see `public/models/README.txt`.

Layout: `src/pages` (routes), `src/components` (Widgets, Layout, Notifications, Charts), `src/utils` (vital severity, notifications), `src/context` (auth).
