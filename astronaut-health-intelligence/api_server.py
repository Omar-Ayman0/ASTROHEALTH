"""
Local, offline-first API for the Health Intelligence Engine (v2.1: live, multi-astronaut).

    uvicorn api_server:app --port 8000
    set HEALTH_SIM_AUTOSTART=1   (optional: start the simulation at boot)
    set HEALTH_ASTRONAUT_COUNT=6 (default 4, max 7)
    set HEALTH_SIM_INTERVAL=1.0  (seconds between readings), HEALTH_START_STEP=576
    set HEALTH_PUSH_URL=http://localhost:PORT/...   (optional best-effort push of events to the local backend)

Live data
  POST /api/v1/simulation/start|stop|reset      GET /api/v1/simulation/status
  POST /api/v1/live/ingest                      one raw reading from the backend -> analysed now
  GET  /api/v1/live/ticks?astronaut_id=&since_seq=       readings + per-reading analysis (to persist); cursor = next_since_seq
Reports and events
  GET  /api/v1/astronauts                       status of every astronaut
  GET  /api/v1/report?astronaut_id=             latest live report (contract: docs/JSON_CONTRACT.md)
  GET  /api/v1/events?astronaut_id=&review_only=true&status=ALL|OPEN|RESOLVED
  GET  /api/v1/events/feed?since_seq=&astronaut_id=&event_type=    ordered, replayable event feed
Stateless helpers / legacy
  POST /api/v1/analyze   POST /api/v1/evaluate-instant   GET /api/v1/simulate/next   POST /api/v1/simulate/reset
"""
import os
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from engine.config import BASELINE_WINDOW_STEPS
from engine.generator import ALL_ASTRONAUTS, DEFAULT_ASTRONAUTS, generate_dataset
from engine.health_engine import evaluate_instant
from engine.live import LiveSystem, EVENT_TYPES
from engine.schemas import SingleVitalReading, AnalyzeRequest, LiveReading

SYSTEM: LiveSystem | None = None


def _boot() -> LiveSystem:
    global SYSTEM
    if SYSTEM is None:
        count = max(1, min(int(os.environ.get("HEALTH_ASTRONAUT_COUNT", len(DEFAULT_ASTRONAUTS))),
                           len(ALL_ASTRONAUTS)))
        ids = ALL_ASTRONAUTS[:count]          # 4 by default; HEALTH_ASTRONAUT_COUNT=6 for six astronauts
        SYSTEM = LiveSystem(
            generate_dataset(ids), ids,
            start_step=int(os.environ.get("HEALTH_START_STEP", BASELINE_WINDOW_STEPS)),
            push_url=os.environ.get("HEALTH_PUSH_URL") or None,
        )
        if os.environ.get("HEALTH_SIM_AUTOSTART") == "1":
            SYSTEM.start(float(os.environ.get("HEALTH_SIM_INTERVAL", "1.0")))
    return SYSTEM


@asynccontextmanager
async def lifespan(_app):
    _boot()
    yield
    if SYSTEM:
        SYSTEM.stop()


app = FastAPI(
    lifespan=lifespan,
    title="Astronaut Health Intelligence Engine API",
    version="2.1.0",
    description="Local offline-first telemetry analysis & anomaly detection, live for several astronauts. "
                "Research prototype - not a medical device.",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _astro(astronaut_id: str):
    try:
        return _boot().get(astronaut_id)
    except KeyError:
        raise HTTPException(404, f"unknown astronaut_id {astronaut_id}; known: {list(_boot().astronauts)}")


@app.get("/health")
def health_check():
    s = _boot()
    return {"status": "ONLINE", "mode": "LOCAL_OFFLINE_READY", "needs_internet": False,
            "astronauts": list(s.astronauts), "simulation_running": s.running,
            "engine_instance_id": s.instance_id}


# ------------------------------------------------------------ live control --
@app.post("/api/v1/simulation/start")
def simulation_start(interval_seconds: float = Query(1.0, ge=0.0),
                     astronaut_ids: str = Query("", description="comma separated; empty = all"),
                     start_step: int = Query(-1, description="-1 = keep current position")):
    ids = [a.strip() for a in astronaut_ids.split(",") if a.strip()] or None
    if ids:
        for a in ids:
            _astro(a)
    return _boot().start(interval_seconds, ids, None if start_step < 0 else start_step)


@app.post("/api/v1/simulation/stop")
def simulation_stop():
    return _boot().stop()


@app.get("/api/v1/simulation/status")
def simulation_status():
    return _boot().status()


@app.post("/api/v1/simulation/reset")
def simulation_reset(start_step: int = Query(BASELINE_WINDOW_STEPS, ge=BASELINE_WINDOW_STEPS),
                     astronaut_id: str = Query("")):
    if astronaut_id:
        _astro(astronaut_id)
    return _boot().reset(start_step, astronaut_id or None)


@app.post("/api/v1/live/ingest")
def live_ingest(reading: LiveReading):
    """Backend-owned data source: send one raw reading, get it analysed immediately."""
    _astro(reading.astronaut_id)
    return _boot().ingest(reading.model_dump())


@app.get("/api/v1/live/ticks")
def live_ticks(astronaut_id: str = Query("ASTRO_01"), since_seq: int = Query(0, ge=0), limit: int = Query(500, le=5000)):
    _astro(astronaut_id)
    return _boot().ticks_since(astronaut_id, since_seq, limit)


# ------------------------------------------------------ reports and events --
@app.get("/api/v1/astronauts")
def astronauts():
    return _boot().summary()


@app.get("/api/v1/report")
def get_report(astronaut_id: str = Query("ASTRO_01")):
    _astro(astronaut_id)
    return _boot().report(astronaut_id)


@app.get("/api/v1/events")
def get_events(astronaut_id: str = Query("ASTRO_01"), review_only: bool = Query(True),
               status: str = Query("ALL")):
    _astro(astronaut_id)
    evs = _boot().events(astronaut_id, review_only, status)
    return {"astronaut_id": astronaut_id, "count": len(evs), "events": evs,
            "data_source": _astro(astronaut_id).data_source}


@app.get("/api/v1/events/feed")
def events_feed(since_seq: int = Query(0, ge=0), astronaut_id: str = Query(""), event_type: str = Query(""),
                limit: int = Query(500, le=5000), engine_instance_id: str = Query("")):
    if event_type and event_type not in EVENT_TYPES:
        raise HTTPException(400, f"event_type must be one of {list(EVENT_TYPES)}")
    return _boot().feed_since(since_seq, astronaut_id or None, event_type or None, limit,
                              engine_instance_id or None)


# ------------------------------------------------- stateless / legacy tools --
@app.post("/api/v1/analyze")
def analyze_window(req: AnalyzeRequest):
    la = _astro(req.astronaut_id)
    df = pd.DataFrame([r.model_dump() for r in req.readings])
    df["astronaut_id"] = req.astronaut_id
    return la.engine.analyze(df, data_source={"type": "api_window", "is_real_astronaut_data": False},
                             calibration_rows=0)["report"]


@app.post("/api/v1/evaluate-instant")
def evaluate_instant_reading(reading: SingleVitalReading):
    la = _astro(reading.astronaut_id)
    return evaluate_instant(la.engine.profile, reading.model_dump(exclude={"astronaut_id", "timestamp"}),
                            reading.timestamp)


@app.get("/api/v1/simulate/next")
def simulate_next(astronaut_id: str = Query("ASTRO_01")):
    """Manual single step (kept for the earlier demo). Prefer /simulation/start for continuous live data."""
    _astro(astronaut_id)
    tick = _boot().step_once(astronaut_id)
    if tick is None:
        return {"finished": True, "astronaut_id": astronaut_id, "hint": "POST /api/v1/simulation/reset"}
    tick["finished"] = False
    return tick


@app.post("/api/v1/simulate/reset")
def simulate_reset(astronaut_id: str = Query("ASTRO_01"),
                   start_step: int = Query(BASELINE_WINDOW_STEPS, ge=BASELINE_WINDOW_STEPS)):
    _astro(astronaut_id)
    return _boot().reset(start_step, astronaut_id)
