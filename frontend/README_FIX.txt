ASTROHEALTH - vitals colour fix (frontend only)

Replace these 3 files in the repo (same paths as inside this zip):
  frontend/src/utils/vitalSeverity.js
  frontend/src/components/Widgets/AstronautHologram.jsx
  frontend/src/components/Widgets/VitalsWidget.jsx

Behaviour: a vital card / hologram callout turns red only when ITS OWN value is
outside the normal range (too low or too high). The engine anomaly flag no longer
turns normal readings red. Normal ranges are in vitalSeverity.js (VITAL_RANGES).

Not touched: backend, engine, n8n/automation, API, JSON contract, schema_version.
Then push -> Vercel redeploys.
