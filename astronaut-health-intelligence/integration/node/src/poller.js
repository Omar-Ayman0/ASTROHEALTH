'use strict';
/**
 * Cursor-safe poller: pulls readings (ticks) and event messages from the engine into a store, exactly once.
 *
 * Rules it implements (see docs/INTEGRATION.md section 6b):
 *  - cursor = next_since_seq of the last page that was SAVED (never last_sequence / last_tick_seq, never step_index);
 *  - the page and its cursor are saved atomically by the store, so a crash between the two cannot lose or repeat data;
 *  - the engine_instance_id is sent back every time; when the engine restarted the response says instance_changed
 *    and the data is served from the start;
 *  - a failed poll leaves the cursor untouched (the next poll retries the same range);
 *  - dedupe: ticks by (instance_id, astronaut_id, tick_seq), events by emission_id (done by the store).
 *
 * Store interface (sync or async):
 *   getCursor(key) -> {instanceId, seq} | null
 *   saveTicks(astronautId, instanceId, ticks, key, newCursor) -> number of NEW ticks stored   (atomic with the cursor)
 *   saveEvents(events, key, newCursor)                         -> array of NEW events stored (atomic with the cursor)
 *   saveReport(report)                                         -> boolean (true if new)
 */
const FEED_KEY = 'feed';
const tickKey = (id) => `ticks:${id}`;

class EnginePoller {
  constructor({ client, store, astronautIds = null, pageLimit = 500, intervalMs = 2000, pollReports = true,
                onNewEvents = null, onError = null, logger = console } = {}) {
    Object.assign(this, { client, store, astronautIds, pageLimit, intervalMs, pollReports, onNewEvents, onError, logger });
    this.timer = null;
    this.running = false;
    this.stats = { ticksStored: 0, eventsStored: 0, reportsStored: 0, errors: 0, lastError: null, lastOkAt: null };
  }

  async _ids() {
    if (this.astronautIds) return this.astronautIds;
    return (await this.client.astronauts()).map((a) => a.astronaut_id);
  }

  async pollFeed() {
    let cur = (await this.store.getCursor(FEED_KEY)) || { instanceId: null, seq: 0 };
    for (let guard = 0; guard < 10000; guard += 1) {
      const r = await this.client.feed({ sinceSeq: cur.seq, limit: this.pageLimit, instanceId: cur.instanceId || undefined });
      const next = { instanceId: r.engine_instance_id, seq: r.next_since_seq };
      const fresh = await this.store.saveEvents(r.events, FEED_KEY, next);
      cur = next;
      this.stats.eventsStored += fresh.length;
      if (fresh.length && this.onNewEvents) await this.onNewEvents(fresh);
      if (!r.has_more) return;
    }
    throw new Error('pollFeed: too many pages in one poll');
  }

  async pollTicks(astronautId) {
    const key = tickKey(astronautId);
    let cur = (await this.store.getCursor(key)) || { instanceId: null, seq: 0 };
    for (let guard = 0; guard < 10000; guard += 1) {
      const r = await this.client.ticks(astronautId, { sinceSeq: cur.seq, limit: this.pageLimit, instanceId: cur.instanceId || undefined });
      const next = { instanceId: r.engine_instance_id, seq: r.next_since_seq };
      if (r.gap_detected) this.logger.warn?.(`[poller] ${astronautId}: readings were dropped by the engine buffer before they were pulled`);
      this.stats.ticksStored += await this.store.saveTicks(astronautId, r.engine_instance_id, r.ticks, key, next);
      cur = next;
      if (!r.has_more) return;
    }
    throw new Error(`pollTicks(${astronautId}): too many pages in one poll`);
  }

  /** One full round. Never throws: errors are counted and the cursors stay where they were. */
  async pollOnce() {
    try {
      const ids = await this._ids();
      for (const id of ids) await this.pollTicks(id);
      await this.pollFeed();
      if (this.pollReports) {
        for (const id of ids) if (await this.store.saveReport(await this.client.report(id))) this.stats.reportsStored += 1;
      }
      this.stats.lastOkAt = new Date().toISOString();
      return { ok: true };
    } catch (err) {
      this.stats.errors += 1;
      this.stats.lastError = String(err.message || err);
      if (this.onError) this.onError(err);
      return { ok: false, error: err };
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      await this.pollOnce();
      if (this.running) this.timer = setTimeout(loop, this.intervalMs);
    };
    loop();
  }

  stop() { this.running = false; if (this.timer) clearTimeout(this.timer); this.timer = null; }
}

module.exports = { EnginePoller, FEED_KEY, tickKey };
