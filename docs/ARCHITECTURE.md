# Architecture

![System architecture](assets/architecture.svg)

The engine serves local reports and event feeds. The active backend worker polls every five seconds, stores cursor and emission receipts, and calls local incident upsert. Initial bootstrap starts at the current last sequence, skipping historical events. Alert delivery retries pending rows every 30 seconds; acknowledgment checks accepted and event ID. Medical state is separate from physiological event state.

```mermaid
flowchart LR
  E[Python engine] --> B[Node backend]
  B --> D[(SQLite)]
  B --> W[n8n]
  W --> B
  B --> F[React dashboards]
  W --> G[Optional Gemini]
```

The standalone Node poller is not the active backend worker. The current local alert outbox is not a separate Earth receiver.
