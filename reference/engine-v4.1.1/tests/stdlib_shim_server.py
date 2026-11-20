"""
TEST HARNESS ONLY - not part of the product, not a replacement for api_server.py.

Serves the same /api/v1 routes as api_server.py using only the Python standard library, calling the same
LiveSystem methods and serialising with plain json.dumps(allow_nan=False) (no to_jsonable safety net).
Use it to run tests/smoke_api.py and the Node client tests on a machine where FastAPI is not installed.
It does NOT prove that FastAPI itself starts: always run the real thing once (see docs/NODE_INTEGRATION.md).

    python tests/stdlib_shim_server.py --port 8765 --astronauts 6
"""
import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.config import BASELINE_WINDOW_STEPS          # noqa: E402
from engine.generator import ALL_ASTRONAUTS, generate_dataset  # noqa: E402
from engine.live import EVENT_TYPES, LiveSystem          # noqa: E402

SYSTEM: LiveSystem | None = None
LOCK = threading.Lock()


def boot(count: int, start_step: int) -> LiveSystem:
    ids = ALL_ASTRONAUTS[:count]
    return LiveSystem(generate_dataset(ids), ids, start_step=start_step, events_log_path=None)


class Http(Exception):
    def __init__(self, code, detail):
        self.code, self.detail = code, detail


def q(params, name, default, cast=str):
    return cast(params[name][0]) if name in params else default


def astro(a):
    try:
        return SYSTEM.get(a)
    except KeyError:
        raise Http(404, f"unknown astronaut_id {a}; known: {list(SYSTEM.astronauts)}")


def route(method, path, params, body):
    s = SYSTEM
    if method == "GET" and path == "/health":
        return {"status": "ONLINE", "mode": "LOCAL_OFFLINE_READY", "needs_internet": False,
                "astronauts": list(s.astronauts), "simulation_running": s.running, "engine_instance_id": s.instance_id}
    if method == "POST" and path == "/api/v1/simulation/start":
        ids = [a.strip() for a in q(params, "astronaut_ids", "").split(",") if a.strip()] or None
        for a in ids or []:
            astro(a)
        st = q(params, "start_step", -1, int)
        return s.start(q(params, "interval_seconds", 1.0, float), ids, None if st < 0 else st)
    if method == "POST" and path == "/api/v1/simulation/stop":
        return s.stop()
    if method == "GET" and path == "/api/v1/simulation/status":
        return s.status()
    if method == "POST" and path == "/api/v1/simulation/reset":
        a = q(params, "astronaut_id", "")
        if a:
            astro(a)
        return s.reset(q(params, "start_step", BASELINE_WINDOW_STEPS, int), a or None)
    if method == "POST" and path == "/api/v1/live/ingest":
        astro(body["astronaut_id"])
        return s.ingest(body)
    if method == "GET" and path == "/api/v1/live/ticks":
        a = q(params, "astronaut_id", "ASTRO_01")
        astro(a)
        return s.ticks_since(a, q(params, "since_seq", 0, int), q(params, "limit", 500, int),
                             q(params, "engine_instance_id", "") or None)
    if method == "GET" and path == "/api/v1/astronauts":
        return s.summary()
    if method == "GET" and path == "/api/v1/report":
        a = q(params, "astronaut_id", "ASTRO_01")
        astro(a)
        return s.report(a)
    if method == "GET" and path == "/api/v1/events":
        a = q(params, "astronaut_id", "ASTRO_01")
        astro(a)
        evs = s.events(a, q(params, "review_only", "true").lower() == "true", q(params, "status", "ALL"))
        return {"astronaut_id": a, "count": len(evs), "events": evs, "data_source": astro(a).data_source}
    if method == "GET" and path == "/api/v1/events/feed":
        et = q(params, "event_type", "")
        if et and et not in EVENT_TYPES:
            raise Http(400, f"event_type must be one of {list(EVENT_TYPES)}")
        return s.feed_since(q(params, "since_seq", 0, int), q(params, "astronaut_id", "") or None, et or None,
                            q(params, "limit", 500, int), q(params, "engine_instance_id", "") or None)
    if method == "GET" and path == "/api/v1/simulate/next":
        a = q(params, "astronaut_id", "ASTRO_01")
        astro(a)
        tick = s.step_once(a)
        if tick is None:
            return {"finished": True, "astronaut_id": a}
        tick["finished"] = False
        return tick
    raise Http(404, "not found")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _do(self, method):
        u = urlparse(self.path)
        body = None
        if method == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}") if n else {}
        try:
            with LOCK:                                     # one request at a time: keeps the shim trivial
                out = route(method, u.path, parse_qs(u.query), body)
            data, code = json.dumps(out, allow_nan=False).encode(), 200   # strict JSON, no safety net
        except Http as e:
            data, code = json.dumps({"detail": e.detail}).encode(), e.code
        except Exception as e:                              # noqa: BLE001
            data, code = json.dumps({"detail": f"{type(e).__name__}: {e}"}).encode(), 500
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._do("GET")

    def do_POST(self):
        self._do("POST")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--astronauts", type=int, default=6)
    ap.add_argument("--start-step", type=int, default=BASELINE_WINDOW_STEPS)
    a = ap.parse_args()
    SYSTEM = boot(a.astronauts, a.start_step)
    httpd = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)        # bind first, then announce
    print(f"shim ready on http://127.0.0.1:{a.port}  astronauts={list(SYSTEM.astronauts)}", flush=True)
    httpd.serve_forever()
