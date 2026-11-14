# Verification report

## Executed in this audit

- Integrated engine: `python -m pytest -q` on Python 3.13.5, Linux. **35 passed, 4 failed (39 total), 93.25 seconds.** Full output: [test log](test-results/engine-pytest.txt).
- Backend JavaScript: `node --check` on root JS, routes and validators, Node 22.16.0 — passed.
- Four n8n exports: parsed JSON, all connection source/target names validated; 17/20/16/7 nodes respectively. Passed static checks only.

## Failures

Three evaluation tests fail at `engine/evaluation.py:136` subtracting a timezone-naive night_start from a timezone-aware start. `test_live_events_equal_batch_events` fails in its timestamp comparison at `tests/test_live.py:114`. These are genuine observed failures in the supplied integrated baseline under the local environment, not evidence that the original Windows environment fails identically. No timestamp algorithm or test was altered. Normalize timestamps consistently and rerun regression tests before a stable release.

## Not executed

Backend npm installation/start, SQLite integration and outbox runtime, frontend build/render, n8n import and credential binding, Gemini calls, full cross-service demo, independent engine regression and actual network interruption testing. No dashboard screenshot captured. Dependency pins in requirements-local.txt reflect installed audit versions, not a verified fresh install. Original pinned requirements retained separately. The newer handoff's reported results are historical, not independently reproduced here.

## Release gate

Resolve timestamp failures; install dependencies cleanly; verify engine health and live stream; check cursor replay, duplicate emissions, incident transitions, missing/invalid API keys, outbox ACK/retry, cross-astronaut isolation, assistant failure handling, and manual WF04. Verify dashboard rendering and attribution. Keep external exposure disabled until security hardening.
