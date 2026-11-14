'use strict';
/**
 * Thin HTTP client for the Python Health Intelligence Engine. Uses the global fetch (Node >= 18). No dependencies.
 * Every method returns the engine's JSON UNCHANGED (nothing is renamed or dropped).
 */
class EngineError extends Error {
  constructor(message, { status = null, body = null, cause = null } = {}) {
    super(message);
    this.name = 'EngineError';
    this.status = status;   // HTTP status, or null for network errors / timeouts
    this.body = body;
    this.cause = cause;
  }
}

class EngineClient {
  constructor({ baseUrl = 'http://127.0.0.1:8000', timeoutMs = 10000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async _request(method, path, { query = {}, body } = {}) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new EngineError(`engine unreachable: ${method} ${url} (${cause.message})`, { cause });
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    if (!res.ok) throw new EngineError(`engine returned ${res.status} for ${method} ${path}`, { status: res.status, body: json ?? text });
    return json;
  }

  health() { return this._request('GET', '/health'); }
  astronauts() { return this._request('GET', '/api/v1/astronauts'); }
  report(astronautId) { return this._request('GET', '/api/v1/report', { query: { astronaut_id: astronautId } }); }
  events(astronautId, { reviewOnly = true, status = 'ALL' } = {}) {
    return this._request('GET', '/api/v1/events', { query: { astronaut_id: astronautId, review_only: reviewOnly, status } });
  }
  /** cursor = next_since_seq of the previous response. Pass the stored engine_instance_id to detect engine restarts. */
  ticks(astronautId, { sinceSeq = 0, limit = 500, instanceId } = {}) {
    return this._request('GET', '/api/v1/live/ticks',
      { query: { astronaut_id: astronautId, since_seq: sinceSeq, limit, engine_instance_id: instanceId } });
  }
  feed({ sinceSeq = 0, limit = 500, instanceId, astronautId, eventType } = {}) {
    return this._request('GET', '/api/v1/events/feed',
      { query: { since_seq: sinceSeq, limit, engine_instance_id: instanceId, astronaut_id: astronautId, event_type: eventType } });
  }
  /** Backend-owned data source: send one raw reading, get it analysed now. Use ONE source per astronaut. */
  ingest(reading) { return this._request('POST', '/api/v1/live/ingest', { body: reading }); }
  simulationStart(intervalSeconds = 1, { astronautIds, startStep } = {}) {
    return this._request('POST', '/api/v1/simulation/start', {
      query: { interval_seconds: intervalSeconds, astronaut_ids: astronautIds && astronautIds.join(','), start_step: startStep } });
  }
  simulationStop() { return this._request('POST', '/api/v1/simulation/stop'); }
  simulationStatus() { return this._request('GET', '/api/v1/simulation/status'); }
  simulationReset({ startStep, astronautId } = {}) {
    return this._request('POST', '/api/v1/simulation/reset', { query: { start_step: startStep, astronaut_id: astronautId } });
  }
}

module.exports = { EngineClient, EngineError };
