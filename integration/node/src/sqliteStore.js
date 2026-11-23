'use strict';
/**
 * Reference store on node:sqlite (built into Node >= 22.5; before 22.13 start node with --experimental-sqlite).
 * Port these tables to your own database. LOSSLESS RULE: the complete engine JSON is kept in `payload`
 * (TEXT, JSON). The other columns are only indexes/filters derived from it, so no engine field can ever be lost,
 * including fields added by later engine versions.
 */
const { DatabaseSync } = require('node:sqlite');

const DDL = `
CREATE TABLE IF NOT EXISTS engine_cursors (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS engine_ticks (            -- one row per reading + its analysis (GET /live/ticks)
  instance_id TEXT NOT NULL, astronaut_id TEXT NOT NULL, tick_seq INTEGER NOT NULL,
  run INTEGER, step_index INTEGER, ts TEXT NOT NULL, activity_state TEXT,
  hybrid_anomaly INTEGER, anomaly_score REAL, max_zscore REAL, trigger_alert INTEGER, is_corrupted INTEGER,
  payload TEXT NOT NULL,                              -- the full tick JSON, unchanged
  PRIMARY KEY (instance_id, astronaut_id, tick_seq));
CREATE INDEX IF NOT EXISTS ix_ticks_astro_ts ON engine_ticks (astronaut_id, ts);

CREATE TABLE IF NOT EXISTS engine_events (           -- one row per event message (GET /events/feed)
  emission_id TEXT PRIMARY KEY,                       -- idempotency key
  event_id TEXT NOT NULL, event_type TEXT NOT NULL, astronaut_id TEXT NOT NULL,
  sequence INTEGER, instance_id TEXT, created_at TEXT, emitted_at TEXT,
  severity TEXT, incident_type TEXT, incident_status TEXT, needs_human_review INTEGER,
  anomaly_score REAL, duration_minutes REAL,
  payload TEXT NOT NULL);                             -- the full envelope JSON, unchanged
CREATE INDEX IF NOT EXISTS ix_events_incident ON engine_events (event_id, sequence);
CREATE INDEX IF NOT EXISTS ix_events_astro ON engine_events (astronaut_id, created_at);

CREATE TABLE IF NOT EXISTS engine_reports (          -- latest-report history (GET /report), one row per new reading
  astronaut_id TEXT NOT NULL, latest_reading_at TEXT NOT NULL, generated_at TEXT,
  status TEXT, severity TEXT, needs_human_review INTEGER, anomaly_score REAL,
  payload TEXT NOT NULL,                              -- the full report JSON, unchanged
  PRIMARY KEY (astronaut_id, latest_reading_at));
`;

const b = (v) => (v === undefined || v === null ? null : Number(Boolean(v)));
const n = (v) => (v === undefined || v === null ? null : Number(v));

class SqliteStore {
  // options.wal (default true, as before): set to false to leave the journal mode of an existing database untouched.
  // RECOMMENDED for integration: give the engine tables their OWN file (e.g. ./engine.db), so your existing database,
  // its journal mode and its data are never touched. The tables use the prefix engine_ and cannot collide with yours.
  constructor(path = ':memory:', { wal = true } = {}) {
    this.db = new DatabaseSync(path);
    if (wal) this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    this.db.exec(DDL);
    this.q = {
      getCursor: this.db.prepare('SELECT value FROM engine_cursors WHERE key = ?'),
      setCursor: this.db.prepare('INSERT INTO engine_cursors(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at'),
      tick: this.db.prepare(`INSERT OR IGNORE INTO engine_ticks(instance_id,astronaut_id,tick_seq,run,step_index,ts,activity_state,hybrid_anomaly,anomaly_score,max_zscore,trigger_alert,is_corrupted,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`),
      event: this.db.prepare(`INSERT OR IGNORE INTO engine_events(emission_id,event_id,event_type,astronaut_id,sequence,instance_id,created_at,emitted_at,severity,incident_type,incident_status,needs_human_review,anomaly_score,duration_minutes,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
      report: this.db.prepare(`INSERT OR IGNORE INTO engine_reports(astronaut_id,latest_reading_at,generated_at,status,severity,needs_human_review,anomaly_score,payload) VALUES(?,?,?,?,?,?,?,?)`),
    };
  }

  _tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  getCursor(key) {
    const row = this.q.getCursor.get(key);
    return row ? JSON.parse(row.value) : null;
  }

  saveTicks(astronautId, instanceId, ticks, key, newCursor) {
    return this._tx(() => {
      let added = 0;
      for (const t of ticks) {
        const i = t.intelligence || {};
        const r = this.q.tick.run(instanceId, astronautId, t.tick_seq, n(t.run), n(t.step_index), String(t.timestamp),
          t.activity_state ?? null, b(i.hybrid_anomaly), n(i.anomaly_score), n(i.max_zscore), b(t.trigger_alert),
          b(t.data_quality?.is_corrupted), JSON.stringify(t));
        added += Number(r.changes);
      }
      this.q.setCursor.run(key, JSON.stringify(newCursor), new Date().toISOString());
      return added;
    });
  }

  saveEvents(events, key, newCursor) {
    return this._tx(() => {
      const fresh = [];
      for (const e of events) {
        const ev = e.event || {};
        const r = this.q.event.run(e.emission_id, e.event_id, e.event_type, e.astronaut_id, n(e.sequence), e.engine_instance_id ?? null,
          e.created_at ?? null, e.emitted_at ?? null, ev.severity ?? null, ev.type ?? null, ev.status ?? null,
          b(ev.needs_human_review), n(ev.anomaly_score), n(ev.duration_minutes), JSON.stringify(e));
        if (Number(r.changes) === 1) fresh.push(e);
      }
      this.q.setCursor.run(key, JSON.stringify(newCursor), new Date().toISOString());
      return fresh;
    });
  }

  saveReport(rep) {
    const r = this.q.report.run(rep.astronaut_id, String(rep.latest_reading_at), rep.generated_at ?? null, rep.status ?? null,
      rep.severity ?? null, b(rep.needs_human_review), n(rep.anomaly_score), JSON.stringify(rep));
    return Number(r.changes) === 1;
  }

  // ---- read helpers for the backend / dashboard (return the ORIGINAL engine JSON) ----
  latestReport(astronautId) {
    const row = this.db.prepare('SELECT payload FROM engine_reports WHERE astronaut_id=? ORDER BY latest_reading_at DESC LIMIT 1').get(astronautId);
    return row ? JSON.parse(row.payload) : null;
  }
  ticksBetween(astronautId, fromTs, toTs, limit = 1000) {
    return this.db.prepare('SELECT payload FROM engine_ticks WHERE astronaut_id=? AND ts>=? AND ts<=? ORDER BY ts, tick_seq LIMIT ?')
      .all(astronautId, fromTs, toTs, limit).map((r) => JSON.parse(r.payload));
  }
  eventsForIncident(eventId) {
    return this.db.prepare('SELECT payload FROM engine_events WHERE event_id=? ORDER BY sequence').all(eventId).map((r) => JSON.parse(r.payload));
  }
  count(table) { return Number(this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c); }
  close() { this.db.close(); }
}

module.exports = { SqliteStore, DDL };
