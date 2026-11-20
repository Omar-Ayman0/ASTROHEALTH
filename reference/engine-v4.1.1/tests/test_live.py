"""
Live / integration tests (no FastAPI needed).  Run:  pytest -q   or   python tests/test_live.py

What they guard (the integration requirements from the n8n / backend side):
  * every astronaut is independent (own baseline, own events, own report)
  * the report is rebuilt after every reading (it is not a static file)
  * one incident -> one HEALTH_REVIEW_REQUIRED event, never one per reading
  * event ids are unique, stable and identical in every field; types match the agreed contract
  * the live tracker produces exactly the incidents the batch analysis finds
  * the feed is ordered and replayable (offline: backend can catch up with since_seq)
  * a background simulation analyses all astronauts without anyone selecting one
"""
import json
import os
import sys
import tempfile
import time
from functools import lru_cache

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.contract import validate_report
from engine.generator import generate_dataset, DEFAULT_ASTRONAUTS
from engine.health_engine import HealthEngine
from engine.live import LiveSystem, EVENT_TYPES

GT = ["scenario_label", "is_anomaly_ground_truth", "is_corrupted_ground_truth", "scenario_onset"]


@lru_cache(maxsize=1)
def data():
    return generate_dataset(DEFAULT_ASTRONAUTS)


def new_system(ids=("ASTRO_01", "ASTRO_02", "ASTRO_03"), start=760, log=False):
    path = os.path.join(tempfile.mkdtemp(), "events.jsonl") if log else None
    return LiveSystem(data(), list(ids), start_step=start, events_log_path=path)


@lru_cache(maxsize=1)
def run_through_acute():
    """ASTRO_01 from step 760 to 900 (acute event at 780 and its end) with the others ticking too."""
    s = new_system(log=True)
    for _ in range(140):
        for a in ("ASTRO_01", "ASTRO_02", "ASTRO_03"):
            s.step_once(a)
    return s


def test_report_is_rebuilt_on_every_reading():
    s = new_system(("ASTRO_01",))
    r0 = s.report("ASTRO_01")
    seen = {r0["latest_reading_at"]}
    gen = {r0["generated_at"]}
    for _ in range(5):
        s.step_once("ASTRO_01")
        r = s.report("ASTRO_01")
        seen.add(r["latest_reading_at"])
        gen.add(r["generated_at"])
        assert r["latest_vitals"]["timestamp"] == r["latest_reading_at"]
    assert len(seen) == 6 and len(gen) == 6            # new data -> new report every time
    assert validate_report(s.report("ASTRO_01")) == []


def test_astronauts_are_independent():
    s = new_system(("ASTRO_01", "ASTRO_02"))
    before = json.dumps(s.report("ASTRO_02"), default=str, sort_keys=True)
    for _ in range(30):
        s.step_once("ASTRO_01")                          # ASTRO_01 hits its acute event
    after = json.dumps(s.report("ASTRO_02"), default=str, sort_keys=True)
    assert before == after                               # ASTRO_02 untouched
    assert s.report("ASTRO_01")["status"] == "REVIEW_REQUIRED"
    assert s.report("ASTRO_02")["status"] != "REVIEW_REQUIRED"
    b1 = s.get("ASTRO_01").engine.profile["metrics"]["heart_rate_bpm"]["mean"]
    b2 = s.get("ASTRO_02").engine.profile["metrics"]["heart_rate_bpm"]["mean"]
    assert abs(b1 - b2) > 2.0                            # own baselines
    assert all(e["astronaut_id"] == "ASTRO_01" for e in s.feed)


def test_one_incident_gives_one_review_event():
    s = run_through_acute()
    feed = [e for e in s.feed if e["astronaut_id"] == "ASTRO_01"]
    reviews = [e for e in feed if e["event_type"] == "HEALTH_REVIEW_REQUIRED"]
    assert len(reviews) == 1, [e["emission_id"] for e in feed]       # ~21 flagged readings, 1 event
    assert reviews[0]["event"]["start"].startswith("2026-11-14 05:00")
    ids = [e["emission_id"] for e in s.feed]
    assert len(ids) == len(set(ids))                                 # idempotency keys are unique
    resolved = [e for e in feed if e["event_type"] == "HEALTH_EVENT_RESOLVED"]
    assert len(resolved) == 1 and resolved[0]["event"]["flagged_readings"] >= 15
    assert resolved[0]["event_id"] == reviews[0]["event_id"]         # same id across the lifecycle


def test_event_envelope_matches_the_agreed_contract():
    s = run_through_acute()
    e = next(x for x in s.feed if x["event_type"] == "HEALTH_REVIEW_REQUIRED")
    assert e["schema_version"] == "1.0" and e["source"] == "health_engine"
    assert e["event_id"] == e["event"]["event_id"]
    assert e["astronaut_id"] == e["event"]["astronaut_id"] == "ASTRO_01"
    assert isinstance(e["event"]["needs_human_review"], bool) and e["event"]["needs_human_review"] is True
    assert isinstance(e["event"]["anomaly_score"], float)
    assert e["data_source"]["is_real_astronaut_data"] is False
    assert e["created_at"].endswith("Z") and e["emitted_at"].endswith("Z")
    assert e["event"]["vitals_involved"][0]["baseline_sigma"] > 0
    assert e["event"]["review_reason"]
    assert e["event_type"] in EVENT_TYPES
    json.dumps(e, allow_nan=False)


def test_live_events_equal_batch_events():
    s = run_through_acute()
    raw = data()[data().astronaut_id == "ASTRO_01"].reset_index(drop=True)
    t0 = raw["timestamp"].iloc[760]                       # the live system only watched from step 760
    batch = [e for e in HealthEngine().fit(raw).analyze(raw.iloc[:900])["events"]
             if __import__("pandas").Timestamp(e["start"]) >= t0]
    live = s.get("ASTRO_01").tracker.all_events()
    assert len(live) >= 2
    key = lambda e: (e["event_id"], e["flagged_readings"], e["needs_human_review"], e["duration_minutes"])
    assert [key(e) for e in batch] == [key(e) for e in live]


def test_feed_is_ordered_and_replayable():
    s = run_through_acute()
    allf = s.feed_since(0)
    seqs = [e["sequence"] for e in allf["events"]]
    assert seqs == sorted(seqs) and seqs[0] == 1
    mid = seqs[0]
    tail = s.feed_since(mid)
    assert tail["count"] == allf["count"] - 1            # "backend was offline": catches up with since_seq
    assert s.feed_since(0, astronaut_id="ASTRO_02")["count"] == 0 or all(
        e["astronaut_id"] == "ASTRO_02" for e in s.feed_since(0, astronaut_id="ASTRO_02")["events"])
    assert s.feed_since(0, event_type="HEALTH_EVENT_RESOLVED")["count"] >= 1


def test_events_are_logged_locally_for_offline_use():
    s = run_through_acute()
    with open(s.events_log_path, encoding="utf-8") as f:
        lines = [json.loads(x) for x in f]
    assert len(lines) == len(s.feed)
    assert s.publisher.url is None                        # no network push unless configured


def test_report_links_the_latest_event_and_explains_it():
    s = new_system(("ASTRO_01",))
    for _ in range(30):
        s.step_once("ASTRO_01")
    r = s.report("ASTRO_01")
    assert r["latest_event_id"] == "ASTRO_01-EV-20261114T0500"
    assert r["active_event"]["event_id"] == r["latest_event_id"]
    assert r["severity"] == "HIGH_REVIEW_PRIORITY"
    assert any("heart_rate_bpm" in f for f in r["key_findings"])
    assert r["summary_metrics"]["events_needing_review"] == 1


def test_background_simulation_runs_all_astronauts_and_stops():
    s = new_system(("ASTRO_01", "ASTRO_02", "ASTRO_03", "ASTRO_04"), start=760)
    s.start(interval_seconds=0.0)
    deadline = time.time() + 20
    while time.time() < deadline and min(la.cursor for la in s.astronauts.values()) < 760 + 8:
        time.sleep(0.05)
    assert s.running
    s.stop()
    assert not s.running
    for a, la in s.astronauts.items():
        assert la.cursor >= 760 + 8, a                     # everyone advanced, nobody was "selected"
        assert la.report["latest_reading_at"] == str(la.last_tick["timestamp"])


def test_external_ingest_works_like_the_simulator():
    s = new_system(("ASTRO_01",), start=760)
    raw = s.get("ASTRO_01").raw
    row = {k: v for k, v in raw.iloc[760].to_dict().items() if k not in GT}
    tick = s.ingest(row)
    assert tick["astronaut_id"] == "ASTRO_01" and tick["step_index"] == 760
    assert "demo_only_scenario_label" in tick and tick["demo_only_scenario_label"] is None
    try:
        s.ingest({**row, "astronaut_id": "NOPE"})
    except KeyError:
        pass
    else:
        raise AssertionError("unknown astronaut must be rejected")


def test_reset_starts_a_new_run_with_new_event_ids_only_if_data_was_produced():
    s = new_system(("ASTRO_01",), start=760)
    assert s.get("ASTRO_01").run == 1
    s.reset(760)
    assert s.get("ASTRO_01").run == 1                      # nothing ran yet: still run 1
    for _ in range(25):
        s.step_once("ASTRO_01")
    first_ids = {e["event_id"] for e in s.feed}
    s.reset(760)
    assert s.get("ASTRO_01").run == 2
    for _ in range(25):
        s.step_once("ASTRO_01")
    second_ids = {e["event_id"] for e in s.feed} - first_ids
    assert second_ids and all(i.endswith("-r2") for i in second_ids)



# ---------------------------------------------------------- pull cursors (no loss, no duplicates) --
def test_ticks_cursor_survives_reset():
    """tick_seq only grows: after a simulation reset (step_index goes back) the backend still gets the new ticks."""
    s = new_system(("ASTRO_01",), start=760)
    for _ in range(30):
        s.step_once("ASTRO_01")
    page1 = s.ticks_since("ASTRO_01", 0)
    assert page1["count"] == 30 and page1["next_since_seq"] == 30 and not page1["has_more"]
    s.reset(start_step=700)                                   # step_index jumps back to 700
    for _ in range(10):
        s.step_once("ASTRO_01")
    page2 = s.ticks_since("ASTRO_01", page1["next_since_seq"])
    assert page2["count"] == 10, "new ticks after a reset must not be skipped"
    assert [t["tick_seq"] for t in page2["ticks"]] == list(range(31, 41))
    assert all(t["run"] == page2["run"] for t in page2["ticks"]) and page2["run"] == 2
    assert page2["ticks"][0]["step_index"] < page1["ticks"][-1]["step_index"]   # step went back, cursor did not
    assert not page2["gap_detected"]


def test_ticks_paging_with_limit_no_loss_no_dup():
    s = new_system(("ASTRO_01",), start=760)
    for _ in range(25):
        s.step_once("ASTRO_01")
    seen, cur = [], 0
    for _ in range(10):
        p = s.ticks_since("ASTRO_01", cur, limit=7)
        seen += [t["tick_seq"] for t in p["ticks"]]
        cur = p["next_since_seq"]
        if not p["has_more"]:
            break
    assert seen == list(range(1, 26))


def test_ticks_detect_engine_restart():
    s = new_system(("ASTRO_01",), start=760)
    for _ in range(12):
        s.step_once("ASTRO_01")
    r = s.ticks_since("ASTRO_01", 10, engine_instance_id="some-old-instance")
    assert r["instance_changed"] is True and r["ticks"][0]["tick_seq"] == 1 and r["engine_instance_id"] == s.instance_id
    ok = s.ticks_since("ASTRO_01", 10, engine_instance_id=s.instance_id)
    assert ok["instance_changed"] is False and [t["tick_seq"] for t in ok["ticks"]] == [11, 12]


def test_feed_cursor_with_limit_loses_nothing():
    """last_sequence is the END of the feed; using it as cursor after a cut page would skip messages."""
    s = new_system(("ASTRO_01",), start=760)
    for _ in range(260):
        s.step_once("ASTRO_01")
    total = s.feed_since(0)["count"]
    assert total >= 4
    got, cur = [], 0
    for _ in range(20):
        r = s.feed_since(cur, limit=2)
        got += [e["sequence"] for e in r["events"]]
        cur = r["next_since_seq"]
        if not r["has_more"]:
            break
    assert got == list(range(1, total + 1))
    assert cur == s.feed_since(0)["last_sequence"]
    # when nothing is new, the cursor stays at the end of the feed
    empty = s.feed_since(cur)
    assert empty["count"] == 0 and empty["next_since_seq"] == cur and not empty["has_more"]


def test_feed_cursor_with_filter():
    s = new_system(("ASTRO_01",), start=760)
    for _ in range(260):
        s.step_once("ASTRO_01")
    r = s.feed_since(0, event_type="HEALTH_EVENT_RESOLVED", limit=1)
    assert r["count"] == 1 and r["has_more"] and r["next_since_seq"] == r["events"][0]["sequence"]
    r2 = s.feed_since(r["next_since_seq"], event_type="HEALTH_EVENT_RESOLVED", limit=1)
    assert r2["events"][0]["sequence"] > r["events"][0]["sequence"]


def test_feed_detects_engine_restart():
    s = new_system(("ASTRO_01",), start=760)
    for _ in range(60):
        s.step_once("ASTRO_01")
    old_instance = "some-old-instance"
    r = s.feed_since(5, engine_instance_id=old_instance)
    assert r["instance_changed"] is True
    assert r["events"] and r["events"][0]["sequence"] == 1            # served from the beginning
    ok = s.feed_since(0, engine_instance_id=s.instance_id)
    assert ok["instance_changed"] is False


# ------------------------------------------------------------------ six independent astronauts --
@lru_cache(maxsize=1)
def six_system():
    """Same construction as api_server with HEALTH_ASTRONAUT_COUNT=6 (ASTRO_01..06), stepped 450 rounds from step 760."""
    from engine.generator import ALL_ASTRONAUTS
    ids = ALL_ASTRONAUTS[:6]
    s = LiveSystem(generate_dataset(ids), ids, start_step=760, events_log_path=None)
    for _ in range(450):
        for a in ids:
            s.step_once(a)
    return s, ids


def test_six_astronauts_are_fully_independent():
    s, ids = six_system()
    assert len(ids) == 6 and list(s.astronauts) == ids
    summary = {r["astronaut_id"]: r for r in s.summary()}
    assert set(summary) == set(ids)
    hr_means = set()
    for a in ids:
        rep = s.report(a)
        assert rep["astronaut_id"] == a and validate_report(rep) == []
        assert rep["live"]["step_index"] == 760 + 450 - 1                 # each one advanced on its own
        hr_means.add(round(rep["baseline"]["metrics"]["heart_rate_bpm"]["mean"], 3))
        page = s.ticks_since(a, 0, limit=5000)
        assert page["count"] == 450 and [t["tick_seq"] for t in page["ticks"]] == list(range(1, 451))
        assert all(t["astronaut_id"] == a for t in page["ticks"])
        # every event in the report belongs to this astronaut only
        assert all(e["astronaut_id"] == a and e["event_id"].startswith(a + "-EV-") for e in rep["events"])
    assert len(hr_means) == 6, "each astronaut must have its own personal baseline"


def test_six_astronauts_feed_is_global_ordered_and_per_astronaut_filterable():
    s, ids = six_system()
    feed = s.feed_since(0, limit=5000)["events"]
    assert feed and [e["sequence"] for e in feed] == list(range(1, len(feed) + 1))
    assert len({e["emission_id"] for e in feed}) == len(feed)
    assert {e["astronaut_id"] for e in feed} <= set(ids)
    assert len({e["astronaut_id"] for e in feed}) >= 2, "several astronauts should have produced incidents"
    for a in ids:
        mine = s.feed_since(0, astronaut_id=a, limit=5000)["events"]
        assert all(e["astronaut_id"] == a for e in mine)
        assert [e["sequence"] for e in mine] == sorted(e["sequence"] for e in mine)


def test_resetting_one_astronaut_leaves_the_other_five_untouched():
    s, ids = six_system.__wrapped__()      # fresh system: this test mutates it, the cached one is shared
    before = {a: (s.get(a).tick_seq, s.get(a).run, s.report(a)["latest_reading_at"]) for a in ids}
    s.reset(start_step=700, astronaut_id="ASTRO_03")
    for a in ids:
        after = (s.get(a).tick_seq, s.get(a).run, s.report(a)["latest_reading_at"])
        if a == "ASTRO_03":
            assert after[0] == before[a][0] and after[1] == before[a][1] + 1   # cursor kept, run bumped
        else:
            assert after == before[a]

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
