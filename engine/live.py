"""
Live, multi-astronaut, offline-first runtime.

    system = LiveSystem(raw_df, ["ASTRO_01", "ASTRO_02", ...])
    system.start(interval_seconds=1.0)          # background simulator: one reading per astronaut per tick
    system.ingest({...reading...})              # OR: the backend feeds readings itself
    system.report("ASTRO_01")                   # always the latest analysis for that astronaut
    system.feed_since(0)                        # health events, ordered, replayable

Properties (what the integration needs):
  * every astronaut has its own baseline, session, history, events and report (nothing is shared);
  * analysis runs for ALL astronauts whether or not anyone is looking at one of them;
  * the report is rebuilt after every reading, not read from a file;
  * one incident -> one HEALTH_REVIEW_REQUIRED event (EventTracker), never one per reading;
  * nothing here needs the internet: events are kept in memory (feed) and appended to a local
    JSONL log; an optional push to the local backend is best-effort and never blocks analysis.
"""
from __future__ import annotations

import json
import os
import queue
import threading
import urllib.request
import uuid
from collections import Counter, deque
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from engine.config import (
    VITAL_COLUMNS, ACTIVE_STATES, EVENT_MERGE_GAP_STEPS, SCHEMA_VERSION,
)
from engine.health_engine import HealthEngine, to_jsonable
from engine.trend_analysis import (
    new_aggregate, add_vital_sample, event_from_aggregate, sleep_analysis,
)

REPORT_WINDOW_STEPS = 432        # 36 h: enough for rolling windows, status and trends
TICK_BUFFER = 5000               # readings kept in memory per astronaut for the ticks feed
SEVERITY_RANK = {"LOW_DEVIATION": 0, "MODERATE_DEVIATION": 1, "HIGH_REVIEW_PRIORITY": 2}
GT_COLS = ["scenario_label", "is_anomaly_ground_truth", "is_corrupted_ground_truth", "scenario_onset"]
DEFAULT_DATA_SOURCE = {"type": "synthetic_simulator", "is_real_astronaut_data": False}

EVENT_TYPES = {
    "HEALTH_REVIEW_REQUIRED": "A new incident reached the human-review threshold. Sent ONCE per incident.",
    "HEALTH_EVENT_ESCALATED": "The same incident got worse (severity rose to HIGH, or it became a sustained drift). Sent at most twice per incident.",
    "HEALTH_EVENT_RESOLVED": "The incident ended (no flagged reading for 30 min of non-exercise time). Sent once.",
}


def _utc_z(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


# ============================================================ event tracker ==
class EventTracker:
    """Turns a stream of per-reading flags into incidents.

    Rule that prevents event spam: while an incident is open, further flagged readings are
    merged into it (same event_id). An incident closes only after more than 30 minutes of
    non-exercise readings without a flag. Only incidents that reach the review threshold are
    ever emitted; single noisy readings (LOW_DEVIATION) stay internal.
    """

    def __init__(self, astronaut_id: str, profile: dict, run: int = 1, data_source: dict | None = None):
        self.astronaut_id, self.profile, self.run = astronaut_id, profile, run
        self.data_source = data_source or DEFAULT_DATA_SOURCE
        self.open: dict | None = None
        self.closed: list[dict] = []

    # -- helpers --------------------------------------------------------------
    @staticmethod
    def _merge(dst: dict, src: dict):
        for col in VITAL_COLUMNS:
            d, s = dst["vitals"][col], src["vitals"][col]
            d["n"] += s["n"]
            d["sum_val"] += s["sum_val"]
            d["sum_exp"] += s["sum_exp"]
            if abs(s["peak"]) > abs(d["peak"]):
                d["peak"] = s["peak"]

    def _snapshot(self, status: str) -> dict:
        o = self.open
        ev = event_from_aggregate(self.astronaut_id, o["start"], o["last_flag"], o["agg"], self.profile,
                                  self.run, o["labels"].most_common(1)[0][0] if o["labels"] else None)
        ev["status"] = status
        return ev

    def _envelope(self, event_type: str, ev: dict, tick: dict) -> dict:
        key = f"{ev['event_id']}:{event_type}"
        if event_type == "HEALTH_EVENT_ESCALATED":
            key += f":{ev['severity']}:{ev['type']}"
        return {
            "schema_version": SCHEMA_VERSION,
            "event_type": event_type,
            "source": "health_engine",
            "event_id": ev["event_id"],
            "emission_id": key,                      # idempotency key: same emission -> same key
            "astronaut_id": self.astronaut_id,
            "created_at": _utc_z(tick["timestamp"]),  # mission / reading clock (as in the agreed example)
            "emitted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),  # wall clock
            "run": self.run,
            "event": dict(ev),
            "data_source": dict(self.data_source),
        }

    # -- main entry -----------------------------------------------------------
    def update(self, tick: dict) -> list[dict]:
        intel = tick["intelligence"]
        flagged = bool(intel["hybrid_anomaly"])
        active = tick["activity_state"] in ACTIVE_STATES
        corrupted = tick["data_quality"]["is_corrupted"]

        sample = new_aggregate()
        if not corrupted:
            for col in VITAL_COLUMNS:
                z, val = tick["zscores"].get(col), tick["vitals"].get(col)
                if z is not None and val is not None:
                    add_vital_sample(sample, col, val, tick["expected_now"][col], z)

        out: list[dict] = []
        if flagged:
            if self.open is None:
                self.open = {"start": tick["timestamp"], "last_flag": tick["timestamp"], "agg": new_aggregate(),
                             "pending": new_aggregate(), "gap": 0, "labels": Counter(),
                             "emitted": False, "rank": -1, "type": None}
            o = self.open
            self._merge(o["agg"], o["pending"])          # interior (unflagged) readings now belong to the event
            o["pending"] = new_aggregate()
            self._merge(o["agg"], sample)
            a = o["agg"]
            a["rows"] += 1
            a["peak_z"] = max(a["peak_z"], float(intel["max_zscore"]))
            a["peak_score"] = max(a["peak_score"], float(intel["anomaly_score"]))
            a["stat"] |= bool(intel["stat_anomaly"])
            a["trend"] |= bool(intel["trend_drift"])
            a["ml"] |= bool(intel["ml_anomaly"])
            o["last_flag"], o["gap"] = tick["timestamp"], 0
            if tick.get("demo_only_scenario_label"):
                o["labels"][tick["demo_only_scenario_label"]] += 1

            snap = self._snapshot("OPEN")
            rank = SEVERITY_RANK[snap["severity"]]
            if snap["needs_human_review"] and not o["emitted"]:
                out.append(self._envelope("HEALTH_REVIEW_REQUIRED", snap, tick))
                o.update(emitted=True, rank=rank, type=snap["type"])
            elif o["emitted"] and (rank > o["rank"] or (snap["type"] == "SUSTAINED_DRIFT" and o["type"] != "SUSTAINED_DRIFT")):
                out.append(self._envelope("HEALTH_EVENT_ESCALATED", snap, tick))
                o.update(rank=rank, type=snap["type"])
        elif self.open is not None:
            o = self.open
            self._merge(o["pending"], sample)
            if not active:
                o["gap"] += 1
            if o["gap"] > EVENT_MERGE_GAP_STEPS:
                snap = self._snapshot("RESOLVED")
                self.closed.append(snap)
                if o["emitted"]:
                    out.append(self._envelope("HEALTH_EVENT_RESOLVED", snap, tick))
                self.open = None
        return out

    def all_events(self) -> list[dict]:
        evs = list(self.closed)
        if self.open is not None:
            evs.append(self._snapshot("OPEN"))
        return evs


# ============================================================ one astronaut ==
class LiveAstronaut:
    def __init__(self, astronaut_id: str, engine: HealthEngine, raw: pd.DataFrame, start_step: int,
                 data_source: dict | None = None):
        self.id, self.engine, self.raw = astronaut_id, engine, raw.reset_index(drop=True)
        self.data_source = {**DEFAULT_DATA_SOURCE, **(data_source or {}), "engine_reads_ground_truth_columns": False}
        self.lock = threading.RLock()
        self.run = 0
        self.tick_seq = 0                       # monotonic per astronaut, NEVER reset (pull cursor for the backend)
        self.ticks: deque = deque(maxlen=TICK_BUFFER)   # survives reset(); each tick carries its `run`
        self.reset(start_step)

    def reset(self, start_step: int):
        with self.lock:
            # a new "run" (new event-id suffix) only when the previous run actually produced data
            had_data = getattr(self, "counters", None) is not None and self.counters["rows"] > 0
            self.run = 1 if self.run == 0 else (self.run + 1 if had_data else self.run)
            hist = self.raw.iloc[:start_step]
            self.session = self.engine.start_stream(hist)
            self.cursor = start_step
            self.window = deque(hist.tail(REPORT_WINDOW_STEPS).to_dict("records"), maxlen=REPORT_WINDOW_STEPS)
            self.hist_ts = list(hist["timestamp"])
            self.hist_state = list(hist["activity_state"]) if "activity_state" in hist else ["UNKNOWN"] * len(hist)
            self.tracker = EventTracker(self.id, self.engine.profile, self.run, self.data_source)
            self.counters = Counter()
            self.last_tick: dict | None = None
            self.report: dict = {}
            self._refresh()

    @property
    def finished(self) -> bool:
        return self.cursor >= len(self.raw)

    def ingest(self, reading: dict) -> tuple[dict, list[dict]]:
        with self.lock:
            reading = {k: v for k, v in reading.items()}
            reading["astronaut_id"] = self.id
            tick = self.session.push(reading)
            self.window.append(reading)
            self.hist_ts.append(pd.Timestamp(reading["timestamp"]))
            self.hist_state.append(reading.get("activity_state") or "UNKNOWN")
            intel = tick["intelligence"]
            self.counters["rows"] += 1
            self.counters["stat"] += int(intel["stat_anomaly"])
            self.counters["ml"] += int(intel["ml_anomaly"])
            self.counters["trend"] += int(intel["trend_drift"])
            self.counters["hybrid"] += int(intel["hybrid_anomaly"])
            self.counters["artifacts"] += int(tick["data_quality"]["is_corrupted"])
            emissions = self.tracker.update(tick)
            self.tick_seq += 1
            tick["tick_seq"] = self.tick_seq    # cursor: strictly increasing, unaffected by reset
            tick["run"] = self.run
            self.ticks.append(tick)
            self.last_tick = tick
            self._refresh()
            tick["report_generated_at"] = self.report["generated_at"]
            return tick, emissions

    def _refresh(self):
        win = pd.DataFrame(list(self.window))
        first_step = self.session.step - len(win)
        cal_rows = int(np.clip(self.engine.calibration_steps - first_step, 0, len(win)))
        sleep = sleep_analysis(pd.DataFrame({"timestamp": self.hist_ts, "activity_state": self.hist_state}),
                               self.engine.profile["calibration_ends"])
        events = self.tracker.all_events()
        rep = self.engine.analyze(win, data_source=self.data_source, calibration_rows=cal_rows,
                                  events=events, sleep=sleep, run=self.run)["report"]
        rep["summary_metrics"] = {
            "analysed_rows": self.counters["rows"],
            "statistical_flags": self.counters["stat"],
            "isolation_forest_flags": self.counters["ml"],
            "trend_flags": self.counters["trend"],
            "hybrid_flags": self.counters["hybrid"],
            "events_total": len(events),
            "events_needing_review": sum(e["needs_human_review"] for e in events),
            "low_deviation_events_hidden": sum(e["severity"] == "LOW_DEVIATION" for e in events),
            "sensor_artifact_rows": self.counters["artifacts"],
        }
        rep["live"] = {"run": self.run, "step_index": self.session.step - 1,
                       "data_quality_window": f"last {len(win)} readings"}
        self.report = rep


# ===================================================================== system ==
class EventPublisher:
    """Optional best-effort push to the LOCAL backend. Never blocks analysis; the feed is the
    reliable channel (the backend can always re-read it with feed_since)."""

    def __init__(self, url: str | None):
        self.url = url
        self.api_key = os.environ.get("HEALTH_PUSH_API_KEY") or None
        self.q: queue.Queue = queue.Queue(maxsize=1000)
        self.sent = self.failed = 0
        if url:
            threading.Thread(target=self._run, daemon=True).start()

    def publish(self, env: dict):
        if self.url:
            try:
                self.q.put_nowait(env)
            except queue.Full:
                self.failed += 1

    def _run(self):
        while True:
            env = self.q.get()
            try:
                headers = {"Content-Type": "application/json"}
                if self.api_key:
                    headers["x-api-key"] = self.api_key
                req = urllib.request.Request(self.url, data=json.dumps(env).encode(),
                                             headers=headers, method="POST")
                urllib.request.urlopen(req, timeout=3).read()
                self.sent += 1
            except Exception:                      # noqa: BLE001  (backend down / offline: feed still has it)
                self.failed += 1


class LiveSystem:
    def __init__(self, raw_all: pd.DataFrame, astronaut_ids: list[str], start_step: int = 576,
                 events_log_path: str | None = "data/live/events.jsonl", push_url: str | None = None,
                 data_source: dict | None = None):
        self.instance_id = uuid.uuid4().hex[:12]
        self.start_step = start_step
        self.astronauts: dict[str, LiveAstronaut] = {}
        for a in astronaut_ids:
            raw = raw_all[raw_all["astronaut_id"] == a].reset_index(drop=True)
            engine = HealthEngine().fit(raw)
            self.astronauts[a] = LiveAstronaut(a, engine, raw, start_step, data_source)
        self.feed: list[dict] = []
        self._feed_lock = threading.Lock()
        self.events_log_path = events_log_path
        if events_log_path:
            os.makedirs(os.path.dirname(events_log_path) or ".", exist_ok=True)
        self.publisher = EventPublisher(push_url)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.interval = 1.0
        self.sim_ids: list[str] = []
        self.tick_count = 0

    # -- access ---------------------------------------------------------------
    def get(self, astronaut_id: str) -> LiveAstronaut:
        if astronaut_id not in self.astronauts:
            raise KeyError(astronaut_id)
        return self.astronauts[astronaut_id]

    def report(self, astronaut_id: str) -> dict:
        return self.get(astronaut_id).report

    def summary(self) -> list[dict]:
        out = []
        for a, la in self.astronauts.items():
            r = la.report
            out.append(to_jsonable({
                "astronaut_id": a, "status": r["status"], "severity": r["severity"],
                "anomaly_score": r["anomaly_score"], "needs_human_review": r["needs_human_review"],
                "latest_reading_at": r["latest_reading_at"], "latest_event_id": r["latest_event_id"],
                "step_index": la.session.step - 1, "finished": la.finished,
                "run": la.run, "model_version": r["model_version"],
            }))
        return out

    def events(self, astronaut_id: str, review_only: bool = True, status: str = "ALL") -> list[dict]:
        evs = self.get(astronaut_id).tracker.all_events()
        if review_only:
            evs = [e for e in evs if e["needs_human_review"]]
        if status != "ALL":
            evs = [e for e in evs if e["status"] == status]
        return to_jsonable(evs)

    def ticks_since(self, astronaut_id: str, since_seq: int = 0, limit: int = 500) -> dict:
        """Readings with tick_seq > since_seq (oldest first). The cursor is `tick_seq`, which only grows
        (a simulation reset does NOT move it back; `step_index` does). Store next_since_seq and send it next time."""
        astro = self.get(astronaut_id)
        with astro.lock:
            buf = list(astro.ticks)
            last = astro.tick_seq
        items = [t for t in buf if t["tick_seq"] > since_seq]
        page = items[:limit]
        has_more = len(items) > limit
        oldest = buf[0]["tick_seq"] if buf else last + 1
        return {"astronaut_id": astronaut_id, "run": astro.run, "last_tick_seq": last,
                "next_since_seq": page[-1]["tick_seq"] if has_more else last,
                "has_more": has_more, "count": len(page),
                # True if readings between your cursor and the oldest kept reading were already dropped (buffer = TICK_BUFFER)
                "gap_detected": bool(buf) and since_seq + 1 < oldest,
                "ticks": page}

    def feed_since(self, since_seq: int = 0, astronaut_id: str | None = None,
                   event_type: str | None = None, limit: int = 500,
                   engine_instance_id: str | None = None) -> dict:
        """Ordered, replayable messages with sequence > since_seq.
        Cursor rule for the backend: store `next_since_seq` (NOT last_sequence) and send it next time.
        It is the sequence of the last message returned when the page was cut by `limit` (has_more=true),
        and the end of the feed otherwise. If `engine_instance_id` is given and differs from the engine's current
        one (engine restarted: sequences started again at 1), `instance_changed` is true and the feed is served from 0."""
        instance_changed = bool(engine_instance_id) and engine_instance_id != self.instance_id
        if instance_changed:
            since_seq = 0
        with self._feed_lock:
            last = self.feed[-1]["sequence"] if self.feed else 0
            items = [e for e in self.feed if e["sequence"] > since_seq]
        if astronaut_id:
            items = [e for e in items if e["astronaut_id"] == astronaut_id]
        if event_type:
            items = [e for e in items if e["event_type"] == event_type]
        page = items[:limit]
        has_more = len(items) > limit
        return {"engine_instance_id": self.instance_id,
                "instance_changed": instance_changed,
                "last_sequence": last,                                   # informational only, do not use as cursor
                "next_since_seq": page[-1]["sequence"] if has_more else last,
                "has_more": has_more,
                "count": len(page), "events": page}

    # -- data in --------------------------------------------------------------
    def _emit(self, envelopes: list[dict]):
        for env in envelopes:
            with self._feed_lock:
                env["sequence"] = len(self.feed) + 1
                env["engine_instance_id"] = self.instance_id
                self.feed.append(env)
            if self.events_log_path:
                with open(self.events_log_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(to_jsonable(env), ensure_ascii=False) + "\n")
            self.publisher.publish(to_jsonable(env))

    def ingest(self, reading: dict) -> dict:
        """Feed one reading (from the simulator or from the backend) and analyse it now."""
        astro = self.get(reading["astronaut_id"])
        tick, emissions = astro.ingest(reading)
        self._emit(emissions)
        tick["emitted_events"] = [e["emission_id"] for e in emissions]
        self.tick_count += 1
        return tick

    def step_once(self, astronaut_id: str) -> dict | None:
        la = self.get(astronaut_id)
        with la.lock:
            if la.finished:
                return None
            reading = la.raw.iloc[la.cursor].to_dict()
            la.cursor += 1
        return self.ingest(reading)

    # -- background simulator ---------------------------------------------------
    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, interval_seconds: float = 1.0, astronaut_ids: list[str] | None = None,
              start_step: int | None = None) -> dict:
        if self.running:
            return self.status()
        if start_step is not None:
            self.reset(start_step)
        self.interval = max(0.0, interval_seconds)
        self.sim_ids = astronaut_ids or list(self.astronauts)
        for a in self.sim_ids:
            self.get(a)
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self.status()

    def _loop(self):
        while not self._stop.is_set():
            progressed = False
            for a in self.sim_ids:
                if self._stop.is_set():
                    break
                if self.step_once(a) is not None:
                    progressed = True
            if not progressed:
                if self._stop.is_set():
                    break
                for a in self.sim_ids:
                    self.get(a).reset(self.start_step)
                self._stop.wait(self.interval)
                continue
            self._stop.wait(self.interval)

    def stop(self) -> dict:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)
        return self.status()

    def reset(self, start_step: int | None = None, astronaut_id: str | None = None):
        was_running = self.running
        if was_running:
            self.stop()
        step = self.start_step if start_step is None else start_step
        for a, la in self.astronauts.items():
            if astronaut_id is None or a == astronaut_id:
                la.reset(step)
        return {"reset": astronaut_id or "ALL", "start_step": step}

    def status(self) -> dict:
        return {"running": self.running, "interval_seconds": self.interval, "astronauts": self.sim_ids,
                "ticks_processed": self.tick_count, "engine_instance_id": self.instance_id,
                "events_in_feed": len(self.feed),
                "push": {"enabled": bool(self.publisher.url), "sent": self.publisher.sent,
                         "failed": self.publisher.failed},
                "progress": {a: f"{la.cursor}/{len(la.raw)}" for a, la in self.astronauts.items()}}

