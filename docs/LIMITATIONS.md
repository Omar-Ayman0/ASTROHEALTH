# Limitations

- Synthetic telemetry only; no diagnosis, prescription or clinical validation.
- Optional Gemini needs network; local monitoring is independent of the assistant.
- Mission connection endpoint returns fixed ONLINE/CONNECTED/0/null values; no operational Earth link, real connectivity detection or validated spacecraft deployment.
- Initial event cursor skips historical events. Standalone poller hook failure may not replay already committed events; this is not the active worker.
- External ingest provenance and simulator/source isolation are incomplete in the newer handoff.
- Separate legacy backend synthetic stream and engine analysis can diverge; use defined synthetic demo source.
- Dashboard roles are not authenticated clinical identities.
- Original dependency pins and full integration require verification on target environment.
