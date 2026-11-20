# Demo and setup

Follow [README](../README.md) to install dependencies, copy backend `.env.example` to `.env` and set a random key. Set HEALTH_ENGINE_URL explicitly to port 8000 because routes and worker have inconsistent fallback ports. Start engine first, then backend, then frontend. Windows launcher expects `.venv` in engine directory.

1. Open engine `/health` and `/api/v1/astronauts`; confirm simulation running.
2. Open dashboard and select an astronaut; inspect baseline and current vitals.
3. Generate a synthetic anomaly using the existing UI/control endpoints; observe engine event and backend incident.
4. Review incident in medical-officer dashboard using ACKNOWLEDGE, START_REVIEW, COMPLETE_REVIEW.
5. With n8n configured, run assistant briefing and inspect evidence references; test unavailable model separately.
6. Run WF04 manually; describe it as a fixed prototype status snapshot.

No Docker deployment is asserted. The supplied compose targeted legacy ML; excluded rather than imply compatibility. Fresh SQLite state is created by backend.
