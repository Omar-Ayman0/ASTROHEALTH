"""
TEMPORARY DEMO MODE for the hackathon: a few PREDEFINED, CLEARLY LABELLED synthetic review-required events.

WHY: with synthetic baseline data the engine (correctly) rarely produces `needs_human_review = true`, so the
downstream automation (backend incident upsert, n8n workflows) has nothing to process during a demo.

WHAT THIS IS NOT
  * It does not touch the detectors, the ML model, the baselines, the thresholds or the clinical rules.
  * It never changes a report, a tick, a real event or a real emission: the real result of every reading is computed
    and emitted by the unchanged `LiveSystem.ingest` FIRST; a synthetic message is added AFTER it as an extra message
    in the existing feed (same envelope, same cursors, same `emission_id` idempotency).
  * It is OFF by default. With the flag off, `make_live_system()` returns the plain `LiveSystem`, no route is
    registered and nothing from this file runs.

ISOLATION FROM LIVE INGESTION
  * Synthetic events are produced ONLY for readings that come from the built-in simulator (`step_once` / the
    simulation loop / `GET /simulate/next`). A reading sent through `POST /live/ingest` (backend-owned data) never
    triggers one; such readings are only counted (`external_ingests_seen`) so the demo status shows the mixing.
  * Data declared real (`data_source.is_real_astronaut_data == true`) never triggers one either.
  * Synthetic events carry no telemetry: ticks and reports are exactly the engine's own.

LIFECYCLE (no threads, no timers: nothing runs in the background, so there is nothing to clean up on stop)
    IDLE --start--> ARMED --scenario finished--> (auto-reset) IDLE      or COMPLETED when HEALTH_DEMO_AUTO_RESET=0
    ARMED --stop / reset--> IDLE        (all counters, de-duplication memory, queued triggers and bookkeeping cleared)

FLAGS (see docs/DEMO_MODE.md)
    HEALTH_DEMO_MODE=1            master switch, default off ("HEALTH_DEMO_INJECT=1" from the first version still works)
    HEALTH_DEMO_SCENARIO=...      medium_then_high (default) | medium_only | high_only | full_lifecycle | manual
    HEALTH_DEMO_SCENARIO_FILE=... JSON playbook, overrides HEALTH_DEMO_SCENARIO
    HEALTH_DEMO_AUTOSTART=1       arm at boot (default 1). 0 = wait for POST /api/v1/demo/start
    HEALTH_DEMO_AUTO_RESET=1      after the scenario ends return to IDLE by itself (default 1)
    HEALTH_DEMO_SCHEDULE / _REPEAT_EVERY / _MAX_EVENTS / _ASTRONAUT / _RESOLVE_AFTER   optional overrides
"""
from __future__ import annotations

import contextlib
import json
import os
import sys
import threading
from collections import OrderedDict

import pandas as pd

from engine.config import SAMPLE_MINUTES
from engine.live import LiveSystem

NOTICE = "SYNTHETIC DEMO TEST EVENT (not a medical finding)"

# Event shapes. Numbers follow the engine's own conventions: >= 3 flagged readings => review;
# anomaly_score = peak_z / 6 (score >= 0.67 <=> >= 4 sigma => HIGH_REVIEW_PRIORITY). Each vital is
# (name, mean z-score over the event, peak z-score). Observed values are computed from the astronaut's REAL
# time-of-day expected value and REAL baseline sigma, so the numbers are plausible for that astronaut.
SCENARIOS = {
    "MEDIUM": {
        "label": "Moderate multi-vital deviation (resting HR up, HRV down, breathing slightly faster)",
        "type": "ACUTE_DEVIATION", "severity": "MODERATE_DEVIATION", "n_rows": 4, "peak_z": 3.4,
        "triggered_by": {"stat": True, "trend": False, "ml": True},
        "vitals": [("heart_rate_bpm", 3.1, 3.4), ("hrv_ms", -2.5, -2.9), ("resp_rate_bpm", 1.5, 1.8)],
    },
    "HIGH": {
        "label": "Marked multi-vital deviation (HR up, SpO2 down, HRV down, breathing faster)",
        "type": "ACUTE_DEVIATION", "severity": "HIGH_REVIEW_PRIORITY", "n_rows": 3, "peak_z": 5.4,
        "triggered_by": {"stat": True, "trend": True, "ml": True},
        "vitals": [("heart_rate_bpm", 5.0, 5.4), ("spo2_pct", -4.4, -4.9), ("hrv_ms", -3.6, -4.1),
                   ("resp_rate_bpm", 2.1, 2.4)],
    },
}

# Selectable playbooks: WHEN the synthetic events fire. "steps" = (processing attempt number, event shape).
PLAYBOOKS = {
    "medium_then_high": {"label": "MEDIUM at attempt 10, HIGH at attempt 20", "steps": [(10, "MEDIUM"), (20, "HIGH")]},
    "medium_only": {"label": "one MEDIUM event at attempt 10", "steps": [(10, "MEDIUM")]},
    "high_only": {"label": "one HIGH event at attempt 10", "steps": [(10, "HIGH")]},
    "full_lifecycle": {"label": "MEDIUM at 10, HIGH at 20, both resolved 15 attempts after they were raised",
                       "steps": [(10, "MEDIUM"), (20, "HIGH")], "resolve_after": 15},
    "manual": {"label": "nothing automatic: fire events yourself with POST /api/v1/demo/trigger", "steps": []},
}
DEFAULT_SCENARIO = "medium_then_high"


class DemoConfigError(ValueError):
    pass


class DemoStateError(RuntimeError):
    """The requested lifecycle action does not fit the current state (HTTP 409)."""


def _flag(env, *names) -> bool:
    return any(str(env.get(n, "0")).strip() == "1" for n in names)


def demo_mode_enabled(env=None) -> bool:
    e = os.environ if env is None else env
    return _flag(e, "HEALTH_DEMO_MODE", "HEALTH_DEMO_INJECT")      # second name = first version, kept working


def _int(e, name, default):
    raw = e.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        raise DemoConfigError(f"{name} must be an integer, got {raw!r}") from None


def load_playbook_file(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        steps = [(int(s["at"]), str(s["severity"]).strip().upper()) for s in data.get("steps", [])]
        pb = {"label": str(data.get("label", f"custom playbook {os.path.basename(path)}")), "steps": steps}
        for k in ("resolve_after", "repeat_every"):
            if k in data:
                pb[k] = int(data[k])
        return pb
    except DemoConfigError:
        raise
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise DemoConfigError(f"HEALTH_DEMO_SCENARIO_FILE {path!r} is not a valid playbook: {exc!r}. "
                              'Expected {"steps":[{"at":10,"severity":"MEDIUM"}], "resolve_after":0}') from None


class DemoConfig:
    def __init__(self, enabled=False, scenario=DEFAULT_SCENARIO, schedule=None, repeat_every=None, max_events=6,
                 astronaut=None, resolve_after=None, autostart=True, auto_reset=True, custom_playbook=None):
        self.enabled = bool(enabled)
        self.autostart, self.auto_reset = bool(autostart), bool(auto_reset)
        self.max_events = int(max_events)
        self.astronaut = astronaut or None
        self.custom = custom_playbook
        self.use_scenario(scenario)
        if schedule is not None:
            self.schedule = list(schedule)
        if repeat_every is not None:
            self.repeat_every = int(repeat_every)
        if resolve_after is not None:
            self.resolve_after = int(resolve_after)
        self.validate()

    def playbooks(self) -> dict:
        return {**PLAYBOOKS, **({self.custom_name: self.custom} if self.custom else {})}

    @property
    def custom_name(self) -> str:
        return "custom"

    def use_scenario(self, name: str):
        """Select a playbook; it replaces schedule / repeat / resolve settings (also any env overrides)."""
        name = (name or "").strip().lower()
        books = self.playbooks()
        if name not in books:
            raise DemoConfigError(f"unknown scenario {name!r}; available: {sorted(books)}")
        pb = books[name]
        self.scenario = name
        self.schedule = list(pb["steps"])
        self.repeat_every = int(pb.get("repeat_every", 0))
        self.resolve_after = int(pb.get("resolve_after", 0))
        return self

    @staticmethod
    def parse_schedule(text: str) -> list[tuple[int, str]]:
        out = []
        for part in [p.strip() for p in text.split(",") if p.strip()]:
            try:
                n, name = part.split(":")
                n, name = int(n), name.strip().upper()
            except ValueError:
                raise DemoConfigError(f"HEALTH_DEMO_SCHEDULE entry {part!r} must look like 10:MEDIUM") from None
            out.append((n, name))
        return out

    def validate(self):
        seen = set()
        for n, name in self.schedule:
            if n < 1:
                raise DemoConfigError(f"attempt numbers start at 1, got {n}")
            if name not in SCENARIOS:
                raise DemoConfigError(f"unknown event shape {name!r}; available: {sorted(SCENARIOS)}")
            if n in seen:
                raise DemoConfigError(f"attempt {n} is scheduled twice")
            seen.add(n)
        if self.repeat_every < 0 or self.resolve_after < 0 or self.max_events < 1:
            raise DemoConfigError("repeat_every / resolve_after must be >= 0 and MAX_EVENTS >= 1")
        if self.repeat_every and self.schedule and self.repeat_every < max(n for n, _ in self.schedule):
            raise DemoConfigError("repeat_every must be >= the last scheduled attempt, "
                                  "otherwise scheduled events would overlap")

    @classmethod
    def from_env(cls, env=None) -> "DemoConfig":
        e = os.environ if env is None else env
        custom, scenario = None, (e.get("HEALTH_DEMO_SCENARIO") or DEFAULT_SCENARIO)
        if (e.get("HEALTH_DEMO_SCENARIO_FILE") or "").strip():
            custom, scenario = load_playbook_file(e["HEALTH_DEMO_SCENARIO_FILE"].strip()), "custom"
        kw = {
            "enabled": demo_mode_enabled(e), "scenario": scenario, "custom_playbook": custom,
            "max_events": _int(e, "HEALTH_DEMO_MAX_EVENTS", 6),
            "autostart": str(e.get("HEALTH_DEMO_AUTOSTART", "1")).strip() != "0",
            "auto_reset": str(e.get("HEALTH_DEMO_AUTO_RESET", "1")).strip() != "0",
            "astronaut": (e.get("HEALTH_DEMO_ASTRONAUT") or "").strip() or None,
            "repeat_every": _int(e, "HEALTH_DEMO_REPEAT_EVERY", None),
            "resolve_after": _int(e, "HEALTH_DEMO_RESOLVE_AFTER", None),
        }
        if (e.get("HEALTH_DEMO_SCHEDULE") or "").strip():
            kw["schedule"] = cls.parse_schedule(e["HEALTH_DEMO_SCHEDULE"])
        return cls(**kw)

    def due(self, attempt: int) -> list[str]:
        names = []
        for n, name in self.schedule:
            if attempt == n or (self.repeat_every and attempt > n and (attempt - n) % self.repeat_every == 0):
                names.append(name)
        return names


class DemoInjector:
    """Lifecycle + bookkeeping + building of the synthetic messages. No threads, no timers, no I/O."""

    SEEN_LIMIT = 20000
    PENDING_LIMIT = 10

    def __init__(self, cfg: DemoConfig, instance_id: str):
        self.cfg, self.instance_id = cfg, instance_id
        self.lock = threading.RLock()
        self.errors = 0
        self.epoch = 0
        self.state = "IDLE"
        self.last_run: dict | None = None
        self._clear()
        if cfg.autostart:
            self.start()

    # ------------------------------------------------------------------ lifecycle
    def _clear(self):
        self.attempts = 0
        self.injected = 0
        self.manual_count = 0
        self.duplicates_ignored = 0
        self.external_ingests_seen = 0
        self._seen: OrderedDict = OrderedDict()
        self._emitted: set = set()
        self._open: list[dict] = []          # synthetic incidents waiting for their RESOLVED message
        self._pending: list[dict] = []       # manual triggers waiting for the next simulated reading

    def _finish(self, reason: str):
        self.last_run = {"scenario": self.cfg.scenario, "ended_by": reason, "epoch": self.epoch,
                         "attempts_counted": self.attempts, "events_injected": self.injected}
        self._clear()
        self.state = "IDLE"

    def start(self, scenario: str | None = None, astronaut: str | None = None) -> dict:
        with self.lock:
            if self.state == "ARMED":
                raise DemoStateError("demo mode is already ARMED; POST /api/v1/demo/stop (or /reset) first")
            if scenario:
                self.cfg.use_scenario(scenario)
                self.cfg.validate()
            if astronaut:
                self.cfg.astronaut = astronaut
            self._clear()
            self.epoch += 1                  # keeps event ids unique across runs of the same engine instance
            self.state = "ARMED"
            return self.status()

    def stop(self, resolve_open: bool = False) -> list[dict]:
        """Disarm and clear everything. Optionally returns HEALTH_EVENT_RESOLVED messages for the still-open
        synthetic incidents (the caller emits them), so the backend does not keep demo incidents open."""
        with self.lock:
            out = [self._resolved(i) for i in self._open] if resolve_open else []
            if self.state == "ARMED":
                self._finish("stop")
            else:
                self._clear()
                self.state = "IDLE"
            return out

    def reset(self, rearm: bool = False) -> dict:
        with self.lock:
            was_armed = self.state == "ARMED"
            if was_armed:
                self._finish("reset")
            else:
                self._clear()
                self.state = "IDLE"
            if rearm:
                self.start()
            return self.status()

    def trigger(self, severity: str, astronaut: str | None = None) -> dict:
        name = (severity or "").strip().upper()
        if name not in SCENARIOS:
            raise DemoConfigError(f"unknown severity {severity!r}; available: {sorted(SCENARIOS)}")
        with self.lock:
            if self.state != "ARMED":
                raise DemoStateError(f"demo mode is {self.state}; POST /api/v1/demo/start first")
            if self.injected + len(self._pending) >= self.cfg.max_events:
                raise DemoStateError(f"MAX_EVENTS ({self.cfg.max_events}) reached for this run")
            if len(self._pending) >= self.PENDING_LIMIT:
                raise DemoStateError("too many queued triggers")
            self._pending.append({"name": name, "astronaut": astronaut or None})
            return {"queued": name, "astronaut": astronaut or "next simulated reading",
                    "note": "the event is created when the next simulator reading is processed",
                    "status": self.status()}

    def note_external_ingest(self):
        if self.state == "ARMED":
            self.external_ingests_seen += 1

    def status(self) -> dict:
        c = self.cfg
        return {"mode": "ON", "state": self.state, "scenario": c.scenario,
                "scenario_description": c.playbooks().get(c.scenario, {}).get("label", ""),
                "available_scenarios": sorted(c.playbooks()), "epoch": self.epoch,
                "schedule": [f"{n}:{s}" for n, s in c.schedule], "repeat_every": c.repeat_every,
                "resolve_after": c.resolve_after, "max_events": c.max_events, "astronaut": c.astronaut,
                "autostart": c.autostart, "auto_reset": c.auto_reset,
                "attempts_counted": self.attempts, "events_injected": self.injected,
                "queued_manual_triggers": len(self._pending), "open_synthetic_incidents": len(self._open),
                "duplicates_ignored": self.duplicates_ignored, "external_ingests_seen": self.external_ingests_seen,
                "errors": self.errors, "last_run": self.last_run,
                "marker": "every injected message carries is_simulated=true and '-DEMO-' in event_id"}

    # ---- entry point, called once per SIMULATED reading, AFTER the real result was produced ----
    def after_ingest(self, astro, tick: dict) -> list[dict]:
        try:
            return self._after_ingest(astro, tick)
        except Exception as exc:                       # noqa: BLE001  the real pipeline must never be affected
            self.errors += 1
            print(f"[demo-mode] ignored error: {exc!r}", file=sys.stderr)
            return []

    def _after_ingest(self, astro, tick: dict) -> list[dict]:
        cfg = self.cfg
        if self.state != "ARMED" or astro.data_source.get("is_real_astronaut_data"):
            return []                                  # never on data declared real
        if cfg.astronaut and astro.id != cfg.astronaut:
            return []
        with self.lock:
            key = (astro.id, astro.run, str(tick["timestamp"]))
            if key in self._seen:                      # the same reading processed again (retry): not a new attempt
                self.duplicates_ignored += 1
                return []
            self._seen[key] = self.attempts + 1
            if len(self._seen) > self.SEEN_LIMIT:
                self._seen.popitem(last=False)
            self.attempts += 1
            attempt = self.attempts
            out: list[dict] = []
            for item in [o for o in self._open if o["due"] <= attempt]:       # optional lifecycle: resolve
                self._open.remove(item)
                out.append(self._resolved(item))
            todo = [(n, f"A{attempt:04d}") for n in cfg.due(attempt)]
            for p in [p for p in self._pending if p["astronaut"] in (None, astro.id)]:
                self._pending.remove(p)
                self.manual_count += 1
                todo.append((p["name"], f"M{self.manual_count:03d}"))
            for name, label in todo:
                if self.injected >= cfg.max_events:
                    break
                env = self._build(astro, tick, name, label)
                if env["emission_id"] in self._emitted:                      # belt and braces against duplicates
                    continue
                self._emitted.add(env["emission_id"])
                self.injected += 1
                out.append(env)
                if cfg.resolve_after:
                    self._open.append({"env": env, "astro": astro, "due": attempt + cfg.resolve_after})
            self._maybe_complete(attempt)
            return out

    def _maybe_complete(self, attempt: int):
        cfg = self.cfg
        capped = self.injected >= cfg.max_events
        if capped:
            self._pending.clear()
        schedule_done = bool(cfg.schedule) and not cfg.repeat_every and attempt >= max(n for n, _ in cfg.schedule)
        if (capped or schedule_done) and not self._pending and not self._open:
            if cfg.auto_reset:
                self._finish("completed")              # engine is back to normal behaviour, no restart needed
            else:
                self.state = "COMPLETED"

    # ---- message construction -------------------------------------------------
    def _event_id(self, astro_id: str, name: str, label: str) -> str:
        suffix = "" if self.epoch <= 1 else f"-E{self.epoch}"
        return f"{astro_id}-DEMO-{name}-{label}-{self.instance_id[:6]}{suffix}"

    def _build(self, astro, tick: dict, name: str, label: str) -> dict:
        sc = SCENARIOS[name]
        end = pd.Timestamp(tick["timestamp"])
        start = end - pd.Timedelta(minutes=SAMPLE_MINUTES * (sc["n_rows"] - 1))
        metrics = astro.engine.profile["metrics"]
        involved = []
        for col, mean_z, peak_z in sc["vitals"]:
            sigma = metrics[col]["std"]
            expected = float(tick["expected_now"][col])          # this astronaut's REAL time-of-day expectation
            involved.append({"vital": col, "direction": "elevated" if mean_z > 0 else "depressed",
                             "observed_mean": round(expected + mean_z * sigma, 3),
                             "expected_mean": round(expected, 3), "baseline_sigma": sigma,
                             "mean_zscore": round(mean_z, 2), "peak_zscore": round(peak_z, 2)})
        involved.sort(key=lambda d: -abs(d["mean_zscore"]))
        top = ", ".join(f"{v['vital']} ({v['direction']}, mean z={v['mean_zscore']:+.1f})" for v in involved[:3])
        reason = (f"{sc['n_rows']} flagged readings (>= 3 required)" if sc["severity"] == "MODERATE_DEVIATION"
                  else f"peak deviation {sc['peak_z']:.1f} sigma (>= 4 required)")
        duration = SAMPLE_MINUTES * sc["n_rows"]
        ev = {
            "event_id": self._event_id(astro.id, name, label), "astronaut_id": astro.id,
            "type": sc["type"], "severity": sc["severity"], "needs_human_review": True,
            "review_reason": f"{NOTICE}: {reason}",
            "start": str(start), "end": str(end), "duration_minutes": duration,
            "flagged_readings": sc["n_rows"], "peak_zscore": round(sc["peak_z"], 2),
            "anomaly_score": round(min(1.0, sc["peak_z"] / 6.0), 3), "triggered_by": dict(sc["triggered_by"]),
            "vitals_involved": involved,
            "explanation": (f"[{NOTICE}] Acute Deviation from {start:%Y-%m-%d %H:%M} to {end:%H:%M} "
                            f"({duration} min, {sc['n_rows']} flagged readings). Main contributors: {top}. "
                            "Compared against the astronaut's own time-of-day baseline. "
                            "This message was injected for a demonstration and does not describe a real reading."),
            "scenario_context_demo_only": f"DEMO_INJECTED_{name}",
            "status": "OPEN", "is_simulated": True,
        }
        return self._mark(astro.tracker._envelope("HEALTH_REVIEW_REQUIRED", ev, tick))

    def _resolved(self, item: dict) -> dict:
        astro, ev = item["astro"], dict(item["env"]["event"])
        ev["status"] = "RESOLVED"
        return self._mark(astro.tracker._envelope("HEALTH_EVENT_RESOLVED", ev, astro.last_tick or {"timestamp": ev["end"]}))

    @staticmethod
    def _mark(env: dict) -> dict:
        env["is_simulated"] = True
        env["data_source"] = {**env["data_source"], "is_simulated": True, "injection": "demo_test_event"}
        return env


class DemoLiveSystem(LiveSystem):
    """LiveSystem + demo mode. Every method delegates to the unchanged parent first."""

    def __init__(self, *args, demo: DemoConfig | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        cfg = demo or DemoConfig.from_env()
        cfg.enabled = True
        if cfg.astronaut and cfg.astronaut not in self.astronauts:
            raise DemoConfigError(f"HEALTH_DEMO_ASTRONAUT={cfg.astronaut!r} is not one of {list(self.astronauts)}")
        self._source = threading.local()
        self.demo = DemoInjector(cfg, self.instance_id)

    # -- which path did a reading come from? only the built-in simulator may trigger synthetic events ----------
    @contextlib.contextmanager
    def simulated_source(self):
        prev = getattr(self._source, "simulated", False)
        self._source.simulated = True
        try:
            yield
        finally:
            self._source.simulated = prev

    def step_once(self, astronaut_id: str):
        with self.simulated_source():                         # simulator loop and GET /simulate/next
            return super().step_once(astronaut_id)

    def ingest(self, reading: dict) -> dict:
        tick = super().ingest(reading)                       # real analysis + real emissions, unchanged
        if getattr(self._source, "simulated", False):
            envs = self.demo.after_ingest(self.get(reading["astronaut_id"]), tick)
            if envs:
                self._emit(envs)                              # extra messages only; the real ones are already out
        else:
            self.demo.note_external_ingest()                  # POST /live/ingest: counted, never injected
        return tick

    def reset(self, start_step: int | None = None, astronaut_id: str | None = None):
        out = super().reset(start_step, astronaut_id)
        if astronaut_id is None:                              # full simulation reset = new run
            self.demo.reset(rearm=self.demo.cfg.autostart)
        return out

    def status(self) -> dict:
        s = super().status()
        s["demo_mode"] = self.demo.status()
        return s

    # -- lifecycle used by the /api/v1/demo/* routes ---------------------------------------------------------
    def _check_astronaut(self, astronaut_id):
        if astronaut_id and astronaut_id not in self.astronauts:
            raise DemoConfigError(f"unknown astronaut_id {astronaut_id!r}; known: {list(self.astronauts)}")

    def demo_start(self, scenario: str | None = None, astronaut_id: str | None = None) -> dict:
        self._check_astronaut(astronaut_id)
        return self.demo.start(scenario, astronaut_id)

    def demo_stop(self, resolve_open: bool = False) -> dict:
        envs = self.demo.stop(resolve_open)
        if envs:
            self._emit(envs)
        return {"stopped": True, "resolved_messages_sent": len(envs), "status": self.demo.status()}

    def demo_reset(self, rearm: bool = False) -> dict:
        return self.demo.reset(rearm)

    def demo_trigger(self, severity: str, astronaut_id: str | None = None) -> dict:
        self._check_astronaut(astronaut_id)
        return self.demo.trigger(severity, astronaut_id)


def make_live_system(*args, **kwargs) -> LiveSystem:
    """Plain LiveSystem unless HEALTH_DEMO_MODE=1. This is the only entry point used by api_server.py."""
    if not demo_mode_enabled():
        return LiveSystem(*args, **kwargs)           # off: no other HEALTH_DEMO_* variable is even read
    cfg = DemoConfig.from_env()
    system = DemoLiveSystem(*args, demo=cfg, **kwargs)
    print(f"[demo-mode] ENABLED scenario={cfg.scenario} state={system.demo.state} "
          "(synthetic events carry is_simulated=true). Never use for real astronaut data.", file=sys.stderr)
    return system


def register_demo_routes(app, get_system) -> bool:
    """Adds /api/v1/demo/* ONLY when demo mode is on. With the flag off this returns at once: no import, no route."""
    if not demo_mode_enabled():
        return False
    from fastapi import HTTPException, Query

    def system():
        s = get_system()
        if not isinstance(s, DemoLiveSystem):
            raise HTTPException(409, "demo mode is not active in this engine instance")
        return s

    def call(fn, *a):
        try:
            return fn(*a)
        except DemoConfigError as exc:
            raise HTTPException(400, str(exc))
        except DemoStateError as exc:
            raise HTTPException(409, str(exc))

    @app.get("/api/v1/demo/status")
    def demo_status():
        return system().demo.status()

    @app.post("/api/v1/demo/start")
    def demo_start(scenario: str = Query(""), astronaut_id: str = Query("")):
        return call(system().demo_start, scenario or None, astronaut_id or None)

    @app.post("/api/v1/demo/trigger")
    def demo_trigger(severity: str = Query("MEDIUM"), astronaut_id: str = Query("")):
        return call(system().demo_trigger, severity, astronaut_id or None)

    @app.post("/api/v1/demo/stop")
    def demo_stop(resolve_open: bool = Query(False)):
        return call(system().demo_stop, resolve_open)

    @app.post("/api/v1/demo/reset")
    def demo_reset(start: bool = Query(False)):
        return call(system().demo_reset, start)

    return True
