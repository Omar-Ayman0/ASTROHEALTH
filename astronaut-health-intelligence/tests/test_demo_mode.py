"""
Tests for TEMPORARY DEMO MODE (engine/demo_injector.py).  Run:  pytest -q tests/test_demo_mode.py
or  python tests/test_demo_mode.py

Key guarantees: (1) flag off => the original engine, byte for byte in behaviour; (2) flag on => the REAL medical
result of every reading is identical, the mode only ADDS clearly marked messages after it; (3) synthetic events come
only from the simulator, never from /live/ingest; (4) start / stop / reset / auto-reset leave a clean engine.
"""
import contextlib
import json
import os
import sys
import tempfile
import threading
from functools import lru_cache

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.contract import EVENT_KEYS, validate_report
from engine.demo_injector import (DemoConfig, DemoConfigError, DemoLiveSystem, DemoStateError, NOTICE, PLAYBOOKS,
                                  demo_mode_enabled, make_live_system, register_demo_routes)
from engine.generator import generate_dataset
from engine.live import LiveSystem

IDS = ["ASTRO_01", "ASTRO_02"]
START = 760                      # a real (non-synthetic) incident of ASTRO_01 happens ~20 readings later
VOLATILE = {"generated_at", "emitted_at", "report_generated_at", "sequence", "engine_instance_id", "emitted_events"}


@lru_cache(maxsize=1)
def raw():
    return generate_dataset(IDS)


def plain():
    return LiveSystem(raw(), IDS, start_step=START, events_log_path=None)


def demo(**cfg):
    cfg.setdefault("auto_reset", False)          # keep counters visible unless a test is about auto-reset
    return DemoLiveSystem(raw(), IDS, start_step=START, events_log_path=None, demo=DemoConfig(enabled=True, **cfg))


@contextlib.contextmanager
def env(**kv):
    saved = {k: os.environ.pop(k) for k in list(os.environ) if k.startswith("HEALTH_DEMO_")}
    os.environ.update({k: str(v) for k, v in kv.items()})
    try:
        yield
    finally:
        for k in [k for k in os.environ if k.startswith("HEALTH_DEMO_")]:
            del os.environ[k]
        os.environ.update(saved)


def run_rounds(system, rounds, retry_attempt=None, simulated=True):
    """one reading per astronaut per round, fixed order. `simulated=True` = how the built-in simulator feeds readings."""
    ctx = system.simulated_source if (simulated and hasattr(system, "simulated_source")) else contextlib.nullcontext
    n = 0
    with ctx():
        for _ in range(rounds):
            for a in IDS:
                la = system.get(a)
                reading = la.raw.iloc[la.cursor].to_dict()
                la.cursor += 1
                system.ingest(reading)
                n += 1
                if retry_attempt == n:
                    system.ingest(dict(reading))         # the same reading processed again (backend retry)
    return system


def strip(x):
    if isinstance(x, dict):
        return {k: strip(v) for k, v in x.items() if k not in VOLATILE}
    if isinstance(x, list):
        return [strip(v) for v in x]
    return x


def synthetic(system):
    return [e for e in system.feed_since(0)["events"] if e.get("is_simulated")]


def real(system):
    return [e for e in system.feed_since(0)["events"] if not e.get("is_simulated")]


def st(system):
    return system.status()["demo_mode"]


# ================================================================ 1. flag off = original engine
def test_disabled_by_default_and_factory_returns_the_plain_live_system():
    with env():
        assert demo_mode_enabled() is False and DemoConfig.from_env({}).enabled is False
        for off in ("0", "true", "yes", ""):
            assert demo_mode_enabled({"HEALTH_DEMO_MODE": off}) is False      # only the literal "1" enables
        s = make_live_system(raw(), IDS, start_step=START, events_log_path=None)
        assert type(s) is LiveSystem and not hasattr(s, "demo") and "demo_mode" not in s.status()
    with env(HEALTH_DEMO_SCHEDULE="garbage", HEALTH_DEMO_SCENARIO="nonsense"):   # leftovers must not matter while off
        assert type(make_live_system(raw(), IDS, start_step=START, events_log_path=None)) is LiveSystem
    with env(HEALTH_DEMO_MODE="1", HEALTH_DEMO_SCHEDULE="garbage"):              # with the switch on, junk fails loudly
        try:
            make_live_system(raw(), IDS, start_step=START, events_log_path=None)
            raise AssertionError("junk schedule accepted")
        except DemoConfigError:
            pass
    with env(HEALTH_DEMO_INJECT="1"):                                            # first-version name still works
        assert type(make_live_system(raw(), IDS, start_step=START, events_log_path=None)) is DemoLiveSystem


def test_flag_off_behaves_exactly_like_the_original_engine_even_with_all_demo_variables_set():
    with env(HEALTH_DEMO_SCENARIO="high_only", HEALTH_DEMO_AUTOSTART="1", HEALTH_DEMO_SCHEDULE="1:HIGH"):
        off = run_rounds(make_live_system(raw(), IDS, start_step=START, events_log_path=None), 30, simulated=False)
    base = run_rounds(plain(), 30, simulated=False)
    assert type(off) is LiveSystem
    assert [e for e in off.feed_since(0)["events"] if e.get("is_simulated")] == []
    assert strip(off.feed_since(0)["events"]) == strip(base.feed_since(0)["events"])
    for a in IDS:
        assert strip(off.report(a)) == strip(base.report(a))
        assert strip(list(off.get(a).ticks)) == strip(list(base.get(a).ticks))
    assert len(real(base)) >= 1, "the window must contain a REAL incident, otherwise this proves nothing"


def test_no_demo_route_is_registered_when_the_flag_is_off():
    class FakeApp:
        def __init__(self):
            self.routes = []

        def _reg(self, kind):
            return lambda path: (lambda fn: self.routes.append((kind, path)) or fn)

        get = property(lambda self: self._reg("GET"))
        post = property(lambda self: self._reg("POST"))

    with env():
        app = FakeApp()
        assert register_demo_routes(app, lambda: None) is False and app.routes == []


def test_no_background_thread_or_timer_is_ever_started_by_demo_mode():
    before = threading.active_count()
    d = demo(scenario="full_lifecycle")
    run_rounds(d, 30)
    d.demo_stop(resolve_open=True)
    d.demo_reset(rearm=True)
    d.demo_stop()
    assert threading.active_count() == before


# ================================================================ 2. selectable scenarios
def test_default_scenario_fires_medium_at_attempt_10_and_high_at_attempt_20_only():
    s = run_rounds(demo(), 15)                    # 30 attempts, two astronauts
    syn = synthetic(s)
    assert [e["event"]["severity"] for e in syn] == ["MODERATE_DEVIATION", "HIGH_REVIEW_PRIORITY"]
    assert [e["event_id"].split("-A")[1][:4] for e in syn] == ["0010", "0020"]
    assert len({e["event_id"] for e in syn}) == 2 and len({e["emission_id"] for e in syn}) == 2
    assert all("-DEMO-" in e["event_id"] and e["event_type"] == "HEALTH_REVIEW_REQUIRED" for e in syn)
    assert st(s)["attempts_counted"] == 20 and st(s)["events_injected"] == 2     # counting stops once the scenario is done
    assert st(s)["state"] == "COMPLETED"                                             # (auto_reset is off in this helper)


def test_every_builtin_scenario_can_be_selected_by_configuration():
    expect = {"medium_only": ["MODERATE_DEVIATION"], "high_only": ["HIGH_REVIEW_PRIORITY"],
              "medium_then_high": ["MODERATE_DEVIATION", "HIGH_REVIEW_PRIORITY"], "manual": []}
    for name, sev in expect.items():
        s = run_rounds(demo(scenario=name), 15)
        assert [e["event"]["severity"] for e in synthetic(s)] == sev, name
    s = run_rounds(demo(scenario="full_lifecycle"), 30)
    kinds = [e["event_type"] for e in synthetic(s)]
    assert kinds.count("HEALTH_REVIEW_REQUIRED") == 2 and kinds.count("HEALTH_EVENT_RESOLVED") == 2
    with env(HEALTH_DEMO_MODE="1", HEALTH_DEMO_SCENARIO="high_only"):
        assert DemoConfig.from_env().schedule == [(10, "HIGH")]
    assert set(PLAYBOOKS) >= {"medium_then_high", "medium_only", "high_only", "full_lifecycle", "manual"}


def test_custom_playbook_file_and_bad_scenarios():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "pb.json")
        with open(path, "w") as f:
            json.dump({"label": "mine", "steps": [{"at": 4, "severity": "high"}, {"at": 6, "severity": "medium"}]}, f)
        with env(HEALTH_DEMO_MODE="1", HEALTH_DEMO_SCENARIO_FILE=path):
            cfg = DemoConfig.from_env()
        assert cfg.scenario == "custom" and cfg.schedule == [(4, "HIGH"), (6, "MEDIUM")]
        s = run_rounds(DemoLiveSystem(raw(), IDS, start_step=START, events_log_path=None, demo=cfg), 6)
        assert [e["event"]["severity"][:4] for e in synthetic(s)] == ["HIGH", "MODE"]
        bad = os.path.join(d, "bad.json")
        open(bad, "w").write('{"steps":[{"at":"x"}]}')
        for e in ({"HEALTH_DEMO_SCENARIO_FILE": bad}, {"HEALTH_DEMO_SCENARIO_FILE": os.path.join(d, "missing.json")},
                  {"HEALTH_DEMO_SCENARIO": "nope"}):
            with env(HEALTH_DEMO_MODE="1", **e):
                try:
                    DemoConfig.from_env()
                    raise AssertionError(f"accepted {e}")
                except DemoConfigError:
                    pass


def test_intervals_are_configurable_and_capped():
    with env(HEALTH_DEMO_MODE="1", HEALTH_DEMO_SCHEDULE="3:HIGH,5:MEDIUM", HEALTH_DEMO_REPEAT_EVERY="10",
             HEALTH_DEMO_MAX_EVENTS="3"):
        cfg = DemoConfig.from_env()
    assert cfg.due(3) == ["HIGH"] and cfg.due(5) == ["MEDIUM"] and cfg.due(13) == ["HIGH"] and cfg.due(4) == []
    cfg.auto_reset = False
    s = DemoLiveSystem(raw(), IDS, start_step=START, events_log_path=None, demo=cfg)
    run_rounds(s, 12)
    assert [e["event"]["severity"][:4] for e in synthetic(s)] == ["HIGH", "MODE", "HIGH"]   # attempts 3, 5, 13; cap = 3
    assert st(s)["events_injected"] == 3


def test_target_astronaut_gets_the_event_and_only_its_attempts_count():
    s = run_rounds(demo(astronaut="ASTRO_02"), 25)
    syn = synthetic(s)
    assert len(syn) == 2 and {e["astronaut_id"] for e in syn} == {"ASTRO_02"}
    assert st(s)["attempts_counted"] == 20 and st(s)["state"] == "COMPLETED"


# ================================================================ 3. isolation from live ingestion
def test_readings_sent_through_live_ingest_never_trigger_synthetic_events():
    s = run_rounds(demo(), 30, simulated=False)                # same readings, but as POST /live/ingest would deliver
    assert synthetic(s) == []
    assert st(s)["attempts_counted"] == 0 and st(s)["external_ingests_seen"] == 60
    assert strip(real(s)) == strip(real(run_rounds(plain(), 30, simulated=False)))


def test_step_once_the_simulator_path_is_what_triggers_events():
    s = demo()
    for _ in range(10):
        s.step_once("ASTRO_01")
    assert [e["event"]["severity"] for e in synthetic(s)] == ["MODERATE_DEVIATION"] and st(s)["external_ingests_seen"] == 0


def test_never_injects_when_the_data_is_declared_real():
    s = DemoLiveSystem(raw(), IDS, start_step=START, events_log_path=None,
                       data_source={"type": "real_ingest", "is_real_astronaut_data": True},
                       demo=DemoConfig(enabled=True))
    run_rounds(s, 15)
    assert synthetic(s) == [] and st(s)["attempts_counted"] == 0


# ================================================================ 4. lifecycle
def test_autostart_off_waits_for_start_and_start_stop_reset_clean_the_state():
    d = demo(autostart=False)
    assert st(d)["state"] == "IDLE"
    run_rounds(d, 15)
    assert synthetic(d) == [] and st(d)["attempts_counted"] == 0                 # idle: really does nothing
    try:
        d.demo_trigger("HIGH")
        raise AssertionError("trigger accepted while IDLE")
    except DemoStateError:
        pass
    assert d.demo_start()["state"] == "ARMED" and st(d)["epoch"] == 1
    try:
        d.demo_start()
        raise AssertionError("second start accepted")
    except DemoStateError:
        pass
    run_rounds(d, 5)                                                             # 10 attempts -> first event
    assert len(synthetic(d)) == 1 and st(d)["attempts_counted"] == 10
    out = d.demo_stop()
    assert out["stopped"] and st(d)["state"] == "IDLE" and st(d)["attempts_counted"] == 0
    assert st(d)["last_run"]["ended_by"] == "stop" and st(d)["last_run"]["events_injected"] == 1
    n = len(synthetic(d))
    run_rounds(d, 15)
    assert len(synthetic(d)) == n                                                # stopped: nothing more
    d.demo_start(scenario="high_only")                                           # a different scenario on the next run
    run_rounds(d, 5)
    assert synthetic(d)[-1]["event_id"].endswith("-E2") and "HIGH" in synthetic(d)[-1]["event_id"]
    assert d.demo_reset()["state"] == "IDLE" and st(d)["events_injected"] == 0
    assert d.demo_reset(rearm=True)["state"] == "ARMED"


def test_stop_can_close_the_open_synthetic_incidents_so_the_backend_does_not_keep_them():
    d = demo(resolve_after=1000)
    run_rounds(d, 15)                                                            # two events raised, none resolved yet
    assert st(d)["open_synthetic_incidents"] == 2
    out = d.demo_stop(resolve_open=True)
    assert out["resolved_messages_sent"] == 2
    syn = synthetic(d)
    raised = {e["event_id"] for e in syn if e["event_type"] == "HEALTH_REVIEW_REQUIRED"}
    assert {e["event_id"] for e in syn if e["event_type"] == "HEALTH_EVENT_RESOLVED"} == raised
    assert d.demo_stop(resolve_open=True)["resolved_messages_sent"] == 0         # nothing left, idempotent


def test_manual_trigger_queues_one_event_for_the_next_simulated_reading():
    d = demo(scenario="manual")
    run_rounds(d, 5)
    assert synthetic(d) == []
    assert d.demo_trigger("high", "ASTRO_02")["queued"] == "HIGH"
    run_rounds(d, 1)
    syn = synthetic(d)
    assert len(syn) == 1 and syn[0]["astronaut_id"] == "ASTRO_02" and "-M001-" in syn[0]["event_id"]
    for bad in ("LOW", ""):
        try:
            d.demo_trigger(bad)
            raise AssertionError("bad severity accepted")
        except DemoConfigError:
            pass
    try:
        d.demo_trigger("HIGH", "ASTRO_99")
        raise AssertionError("unknown astronaut accepted")
    except DemoConfigError:
        pass


# ================================================================ 5. auto-reset: back to the original behaviour
def test_auto_reset_returns_the_engine_to_idle_after_the_scenario_without_a_restart():
    d = DemoLiveSystem(raw(), IDS, start_step=START, events_log_path=None, demo=DemoConfig(enabled=True))   # auto_reset default
    run_rounds(d, 11)                                                           # attempt 20 is the last scheduled one
    assert [e["event"]["severity"][:4] for e in synthetic(d)] == ["MODE", "HIGH"]
    assert st(d)["state"] == "IDLE" and st(d)["attempts_counted"] == 0
    assert st(d)["last_run"] == {"scenario": "medium_then_high", "ended_by": "completed", "epoch": 1,
                                 "attempts_counted": 20, "events_injected": 2}
    n_syn = len(synthetic(d))
    run_rounds(d, 15)
    assert len(synthetic(d)) == n_syn and st(d)["attempts_counted"] == 0       # normal engine again
    assert d.demo_start()["state"] == "ARMED"                                    # and the demo can be run again


def test_after_auto_reset_the_real_feed_is_identical_to_the_original_engine():
    d = run_rounds(DemoLiveSystem(raw(), IDS, start_step=START, events_log_path=None, demo=DemoConfig(enabled=True)), 40)
    base = run_rounds(plain(), 40, simulated=False)
    assert st(d)["state"] == "IDLE" and len(synthetic(d)) == 2
    assert strip(real(d)) == strip(real(base))
    for a in IDS:
        assert strip(d.report(a)) == strip(base.report(a))


def test_auto_reset_waits_for_the_resolution_messages_of_the_scenario():
    d = DemoLiveSystem(raw(), IDS, start_step=START, events_log_path=None,
                       demo=DemoConfig(enabled=True, scenario="full_lifecycle"))
    run_rounds(d, 12)                                                           # 24 attempts: HIGH raised at 20, resolves at 35
    assert st(d)["state"] == "ARMED" and st(d)["open_synthetic_incidents"] >= 1
    run_rounds(d, 10)
    assert st(d)["state"] == "IDLE" and st(d)["last_run"]["ended_by"] == "completed"
    assert [e["event_type"] for e in synthetic(d)].count("HEALTH_EVENT_RESOLVED") == 2


def test_full_simulation_reset_starts_a_new_run_with_new_unique_ids_partial_reset_does_not():
    d = run_rounds(demo(), 9)                                                   # 18 attempts: only the MEDIUM event so far
    first = [e["event_id"] for e in synthetic(d)]
    assert len(first) == 1
    d.reset(start_step=START, astronaut_id="ASTRO_02")                          # one astronaut only: counter untouched
    assert st(d)["epoch"] == 1 and st(d)["attempts_counted"] == 18
    d.reset(start_step=START)                                                   # everything: new demo run (autostart)
    assert st(d)["epoch"] == 2 and st(d)["attempts_counted"] == 0 and st(d)["state"] == "ARMED"
    run_rounds(d, 12)                                                           # same timestamps as before are fine now
    second = [e["event_id"] for e in synthetic(d)][len(first):]
    assert len(second) == 2 and not (set(first) & set(second)) and all(i.endswith("-E2") for i in second)


# ================================================================ 6. the real result is untouched
def test_original_medical_results_are_identical_with_and_without_demo_mode():
    p, d = run_rounds(plain(), 30, simulated=False), run_rounds(demo(), 30)
    assert len(synthetic(d)) == 2
    for a in IDS:
        assert strip(p.report(a)) == strip(d.report(a))                      # report: status, needs_human_review, events...
        assert strip(list(p.get(a).ticks)) == strip(list(d.get(a).ticks))   # every tick incl. hybrid_anomaly
        assert strip(p.events(a, review_only=False)) == strip(d.events(a, review_only=False))
    pr, dr = real(p), real(d)
    assert len(pr) >= 1, "the window must contain at least one REAL incident, otherwise this test proves nothing"
    assert strip(pr) == strip(dr) and [e["emission_id"] for e in pr] == [e["emission_id"] for e in dr]


def test_synthetic_events_never_appear_in_reports_or_the_engine_event_list():
    d = run_rounds(demo(), 30)
    syn_ids = {e["event_id"] for e in synthetic(d)}
    for a in IDS:
        rep = d.report(a)
        assert validate_report(rep) == []
        ids = {e["event_id"] for e in rep["events"]} | {e["event_id"] for e in d.events(a, review_only=False)}
        assert not (ids & syn_ids)
        assert rep["data_source"]["is_real_astronaut_data"] is False and "is_simulated" not in rep["data_source"]


# ================================================================ 7. the message itself (backend compatibility)
def test_synthetic_message_has_exactly_the_real_structure_plus_markers():
    d = run_rounds(demo(), 30)
    real_env, syn = real(d)[0], synthetic(d)
    for e in syn:
        assert set(e) == set(real_env) | {"is_simulated"}
        assert e["is_simulated"] is True and e["event"]["is_simulated"] is True
        assert EVENT_KEYS <= set(e["event"]) and set(e["event"]) - set(real_env["event"]) == {"is_simulated"}
        assert set(e["data_source"]) - set(real_env["data_source"]) == {"is_simulated", "injection"}
        assert e["data_source"]["is_real_astronaut_data"] is False and e["source"] == "health_engine"
        assert e["event"]["needs_human_review"] is True and e["event"]["status"] == "OPEN"
        assert e["event"]["explanation"].startswith(f"[{NOTICE}]") and e["event"]["review_reason"].startswith(NOTICE)
        assert e["event"]["scenario_context_demo_only"].startswith("DEMO_INJECTED_")
        for v in e["event"]["vitals_involved"]:
            assert set(v) == set(real_env["event"]["vitals_involved"][0])
        json.dumps(e, allow_nan=False)                                       # strict JSON, no NaN


def test_synthetic_numbers_use_the_astronauts_real_expectation_and_sigma():
    d = run_rounds(demo(), 15)
    e = synthetic(d)[1]
    la = d.get(e["astronaut_id"])
    for v in e["event"]["vitals_involved"]:
        assert v["baseline_sigma"] == la.engine.profile["metrics"][v["vital"]]["std"]
        z = (v["observed_mean"] - v["expected_mean"]) / v["baseline_sigma"]
        assert abs(z - v["mean_zscore"]) < 0.05
    ev = e["event"]
    assert ev["anomaly_score"] >= 0.67 and ev["peak_zscore"] >= 4.0          # engine convention for HIGH_REVIEW_PRIORITY
    assert ev["end"] <= str(la.ticks[-1]["timestamp"])                         # uses the reading clock, never the future


def test_a_retried_reading_is_not_a_new_attempt_and_creates_no_duplicate():
    once = run_rounds(demo(), 15)
    retried = run_rounds(demo(), 15, retry_attempt=10)                        # attempt 10 sent twice
    norm = lambda sysm: [e["emission_id"].replace(sysm.instance_id[:6], "<instance>") for e in synthetic(sysm)]
    assert norm(once) == norm(retried) and len(synthetic(retried)) == 2
    assert st(retried)["duplicates_ignored"] == 1 and st(retried)["attempts_counted"] == 20


def test_bad_configuration_fails_loudly_instead_of_silently():
    for bad in ({"HEALTH_DEMO_SCHEDULE": "10:LOW"}, {"HEALTH_DEMO_SCHEDULE": "ten:HIGH"},
                {"HEALTH_DEMO_SCHEDULE": "10:HIGH,10:MEDIUM"}, {"HEALTH_DEMO_SCHEDULE": "0:HIGH"},
                {"HEALTH_DEMO_REPEAT_EVERY": "5"}, {"HEALTH_DEMO_MAX_EVENTS": "x"}):
        try:
            DemoConfig.from_env({"HEALTH_DEMO_MODE": "1", **bad})
            raise AssertionError(f"accepted {bad}")
        except DemoConfigError:
            pass
    try:
        DemoLiveSystem(raw(), IDS, start_step=START, events_log_path=None,
                       demo=DemoConfig(enabled=True, astronaut="ASTRO_99"))
        raise AssertionError("unknown astronaut accepted")
    except DemoConfigError:
        pass


# ================================================================ 8. HTTP routes (only when FastAPI is installed)
def test_demo_routes_exist_only_when_the_flag_is_on():
    try:
        import fastapi  # noqa: F401
    except ImportError:
        return                                   # controller logic is covered above; routes need FastAPI
    class FakeApp:
        def __init__(self):
            self.routes = {}
        def get(self, p):
            return lambda fn: self.routes.setdefault(("GET", p), fn)
        def post(self, p):
            return lambda fn: self.routes.setdefault(("POST", p), fn)
    d = demo(autostart=False)
    with env(HEALTH_DEMO_MODE="1"):
        app = FakeApp()
        assert register_demo_routes(app, lambda: d) is True
    assert set(app.routes) == {("GET", "/api/v1/demo/status"), ("POST", "/api/v1/demo/start"),
                               ("POST", "/api/v1/demo/trigger"), ("POST", "/api/v1/demo/stop"),
                               ("POST", "/api/v1/demo/reset")}
    assert app.routes[("POST", "/api/v1/demo/start")]("", "")["state"] == "ARMED"


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS  {name}")
        except Exception as exc:                       # noqa: BLE001
            failed += 1
            print(f"FAIL  {name}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
