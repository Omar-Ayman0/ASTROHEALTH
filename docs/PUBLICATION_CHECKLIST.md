# Publication checklist

## Materials
- [x] Actual demo recording and five dashboard frames included; supplied workflow screenshots included.
- [ ] Optional hosted demo URL (GitHub release asset, YouTube or Drive) to replace relative MP4 link; current bundled link works as a file link, not guaranteed inline playback.
- [ ] Confirm full names, profile URLs and the two research/presentation teammates' names; do not invent them.
- [ ] Supply official challenge title and submission URL.
- [ ] Confirm permission to publish video, screenshots, and all team code/assets.

## Technical gates
- [ ] Install backend/frontend dependencies, verify startup, SQLite, engine feed, dashboard build and routes.
- [ ] Reproduce original pinned Python environment; review proposed UTC fix and rerun all tests.
- [ ] Verify legacy-generator disablement and approve config change if desired.
- [ ] Import WF01–04, rebind credentials, configure local endpoints; validate review state transitions, deduplication, failure/retry and assistant evidence references.
- [ ] Add authentication and authorization before external runtime exposure; confirm no secrets in Git history.
- [ ] Publish repository and tag only after team review. See [instructions](PUBLISHING.md).
