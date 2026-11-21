"""
HTTP smoke test for the engine API (stdlib only). Works against the REAL server or the test shim:

    uvicorn api_server:app --port 8000          (terminal 1; HEALTH_ASTRONAUT_COUNT=6 for six astronauts)
    python tests/smoke_api.py http://127.0.0.1:8000 --astronauts 6 --stateless

Exit code 0 = every check passed. It moves the simulation (resets ASTRO_02 to step 760 and steps a few readings),
so run it on a fresh engine, not during a demo.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

RESULTS = []


def http(base, method, path, body=None):
    req = urllib.request.Request(base + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{detail}]" if (detail and not cond) else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", default="http://127.0.0.1:8000")
    ap.add_argument("--astronauts", type=int, default=4, help="how many astronauts the engine was started with")
    ap.add_argument("--stateless", action="store_true", help="also test /analyze and /evaluate-instant (real server only)")
    ap.add_argument("--docs", action="store_true", help="also check /docs and /openapi.json (real FastAPI only)")
    a = ap.parse_args()
    b = a.base.rstrip("/")

    c, h = http(b, "GET", "/health")
    check("GET /health", c == 200 and h["needs_internet"] is False and len(h["astronauts"]) == a.astronauts, h)
    ids = h["astronauts"]
    inst = h["engine_instance_id"]

    if a.docs:
        req = urllib.request.Request(b + "/docs")
        with urllib.request.urlopen(req, timeout=30) as r:
            check("GET /docs (Swagger UI)", r.status == 200 and b"swagger" in r.read().lower())
        c, spec = http(b, "GET", "/openapi.json")
        paths = set(spec.get("paths", {}))
        check("GET /openapi.json lists the contract endpoints", {"/api/v1/report", "/api/v1/events/feed",
              "/api/v1/live/ticks", "/api/v1/live/ingest", "/api/v1/astronauts"} <= paths, sorted(paths))

    c, summ = http(b, "GET", "/api/v1/astronauts")
    need = {"astronaut_id", "status", "severity", "anomaly_score", "needs_human_review", "latest_reading_at",
            "latest_event_id", "step_index", "finished", "run", "model_version"}
    check(f"GET /astronauts -> {a.astronauts} rows with all fields",
          c == 200 and len(summ) == a.astronauts and all(need <= set(r) for r in summ))

    ok = True
    for x in ids:
        c, r = http(b, "GET", f"/api/v1/report?astronaut_id={x}")
        ok &= c == 200 and r["schema_version"] == "1.0" and r["astronaut_id"] == x and "baseline" in r and "latest_vitals" in r
    check("GET /report for every astronaut (schema_version 1.0)", ok)

    c, e = http(b, "GET", "/api/v1/events?astronaut_id=ASTRO_01&review_only=false")
    check("GET /events shape", c == 200 and {"astronaut_id", "count", "events", "data_source"} <= set(e))
    check("unknown astronaut -> 404", http(b, "GET", "/api/v1/report?astronaut_id=NOPE")[0] == 404)
    check("bad event_type -> 400", http(b, "GET", "/api/v1/events/feed?event_type=BAD")[0] == 400)

    # drive ASTRO_01 through its acute event and ASTRO_02 through a few readings
    http(b, "POST", "/api/v1/simulation/reset?start_step=760&astronaut_id=ASTRO_01")
    http(b, "POST", "/api/v1/simulation/reset?start_step=760&astronaut_id=ASTRO_02")
    for _ in range(60):
        c, t = http(b, "GET", "/api/v1/simulate/next?astronaut_id=ASTRO_01")
    check("simulate/next returns a tick with tick_seq and run", c == 200 and "tick_seq" in t and "run" in t, t)
    for _ in range(10):
        http(b, "GET", "/api/v1/simulate/next?astronaut_id=ASTRO_02")

    # ---- tick cursor: paging without loss / duplicates
    seen, cur, pages = [], 0, 0
    while pages < 100:
        c, p = http(b, "GET", f"/api/v1/live/ticks?astronaut_id=ASTRO_01&since_seq={cur}&limit=17")
        seen += [t["tick_seq"] for t in p["ticks"]]
        cur, pages = p["next_since_seq"], pages + 1
        if not p["has_more"]:
            break
    check("ticks: paging with limit=17 returns 1..N exactly once", seen == list(range(1, len(seen) + 1)) and len(seen) >= 60,
          f"{len(seen)} ticks")
    # ---- the reset bug: after reset step_index goes back, the cursor must not
    before = cur
    http(b, "POST", "/api/v1/simulation/reset?start_step=700&astronaut_id=ASTRO_01")
    for _ in range(5):
        http(b, "GET", "/api/v1/simulate/next?astronaut_id=ASTRO_01")
    c, p = http(b, "GET", f"/api/v1/live/ticks?astronaut_id=ASTRO_01&since_seq={before}")
    check("ticks: new ticks after a reset are still returned (cursor survives reset)",
          p["count"] == 5 and p["ticks"][0]["tick_seq"] == before + 1 and p["ticks"][0]["step_index"] < 760 and p["run"] >= 2, p.get("count"))

    c, p = http(b, "GET", f"/api/v1/live/ticks?astronaut_id=ASTRO_01&since_seq=3&engine_instance_id={inst}")
    check("ticks: same engine_instance_id -> instance_changed false", p["instance_changed"] is False and p["engine_instance_id"] == inst)
    c, p = http(b, "GET", "/api/v1/live/ticks?astronaut_id=ASTRO_01&since_seq=3&limit=2&engine_instance_id=old-instance")
    check("ticks: unknown engine_instance_id -> instance_changed true and served from tick_seq 1",
          p["instance_changed"] is True and p["ticks"][0]["tick_seq"] == 1)

    # ---- event feed cursor
    c, full = http(b, "GET", f"/api/v1/events/feed?since_seq=0&limit=5000&engine_instance_id={inst}")
    check("feed: same engine_instance_id -> instance_changed false", full["instance_changed"] is False)
    total = full["count"]
    got, cur, n = [], 0, 0
    while n < 100:
        c, f = http(b, "GET", f"/api/v1/events/feed?since_seq={cur}&limit=1")
        got += [e["sequence"] for e in f["events"]]
        cur, n = f["next_since_seq"], n + 1
        if not f["has_more"]:
            break
    check("feed: paging with limit=1 using next_since_seq returns every message once", total >= 1 and got == list(range(1, total + 1)),
          f"total={total} got={got}")
    c, f = http(b, "GET", "/api/v1/events/feed?since_seq=5&engine_instance_id=old-instance")
    check("feed: unknown engine_instance_id -> instance_changed true and served from 0",
          f["instance_changed"] is True and (not f["events"] or f["events"][0]["sequence"] == 1))
    if total:
        e0 = full["events"][0]
        check("feed message has the agreed envelope", {"schema_version", "event_type", "source", "event_id", "emission_id",
              "astronaut_id", "created_at", "emitted_at", "run", "event", "data_source", "sequence",
              "engine_instance_id"} <= set(e0), sorted(e0))

    # ---- external ingest (backend-owned data source) on the astronaut that is NOT being replayed
    c, last = http(b, "GET", "/api/v1/live/ticks?astronaut_id=ASTRO_02&since_seq=0&limit=5000")
    ts = datetime.fromisoformat(last["ticks"][-1]["timestamp"]) + timedelta(minutes=5)
    reading = {"astronaut_id": "ASTRO_02", "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"), "heart_rate_bpm": 62.0,
               "hrv_ms": 58.0, "spo2_pct": 97.0, "skin_temp_c": 36.4, "resp_rate_bpm": 14.0, "activity_state": "REST"}
    c, t = http(b, "POST", "/api/v1/live/ingest", reading)
    check("POST /live/ingest -> analysed tick with tick_seq", c == 200 and t.get("tick_seq") == last["last_tick_seq"] + 1, t)
    check("POST /live/ingest for an unknown astronaut -> 404",
          http(b, "POST", "/api/v1/live/ingest", {**reading, "astronaut_id": "NOPE"})[0] in (404, 422))

    c, st = http(b, "GET", "/api/v1/simulation/status")
    check("GET /simulation/status", c == 200 and "running" in st and "engine_instance_id" in st)
    c, r = http(b, "GET", "/api/v1/report?astronaut_id=ASTRO_01")
    check("report keeps updating (latest_reading_at present)", c == 200 and r.get("latest_reading_at"))

    if a.stateless:
        c, ev = http(b, "POST", "/api/v1/evaluate-instant", {"astronaut_id": "ASTRO_01", "heart_rate_bpm": 72, "hrv_ms": 55,
                     "spo2_pct": 97, "skin_temp_c": 36.5, "resp_rate_bpm": 14, "timestamp": "2026-11-14 08:00:00",
                     "activity_state": "REST"})
        check("POST /evaluate-instant", c == 200, ev)

    bad = [n for n, ok in RESULTS if not ok]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} checks passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
