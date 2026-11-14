'use strict';
/**
 * Express router for the Dashboard / n8n. Mount it in your existing Express app:
 *
 *   const express = require('express');
 *   const { EngineClient, SqliteStore, EnginePoller, createEngineRouter } = require('./integration/node/src');
 *   const client = new EngineClient({ baseUrl: process.env.ENGINE_URL });
 *   const store = new SqliteStore(process.env.ENGINE_DB || './engine.db');
 *   app.use('/api/health-engine', createEngineRouter(express, { client, store }));
 *   new EnginePoller({ client, store, onNewEvents: forwardToN8n }).start();
 *
 * Routes (JSON bodies are the engine's JSON, unchanged, so the contract in docs/JSON_CONTRACT.md applies as is):
 *   GET  /astronauts                       live status wall (proxied)
 *   GET  /report/:id                       latest live report (proxied; falls back to the last stored report if the engine is down)
 *   GET  /events/:id?review_only=true      incidents of one astronaut (proxied)
 *   GET  /history/:id/ticks?from=&to=      stored readings + analysis (from your DB)
 *   GET  /history/:id/report               last stored report (from your DB)
 *   GET  /incident/:eventId                all stored messages of one incident, in order (from your DB)
 *   POST /ingest                           send one raw reading to the engine (backend-owned data source)
 *   GET  /health                           engine reachability + poller counters
 */
function createEngineRouter(express, { client, store, poller = null }) {
  const router = express.Router();
  router.use(express.json());
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
      const status = err.status && err.status < 500 ? err.status : 502;
      res.status(status).json({ error: String(err.message || err), engine_body: err.body ?? null });
    }
  };

  router.get('/astronauts', wrap(async (_req, res) => res.json(await client.astronauts())));
  router.get('/report/:id', wrap(async (req, res) => {
    try { res.json(await client.report(req.params.id)); } catch (err) {
      if (err.status === null && store?.latestReport) {            // engine unreachable -> last stored report
        const last = store.latestReport(req.params.id);
        if (last) return res.set('X-Data-Source', 'stored-last-report').json(last);
      }
      throw err;
    }
  }));
  router.get('/events/:id', wrap(async (req, res) =>
    res.json(await client.events(req.params.id, { reviewOnly: req.query.review_only !== 'false', status: req.query.status || 'ALL' }))));
  router.get('/history/:id/ticks', wrap(async (req, res) => {
    const { from = '0000', to = '9999' } = req.query;
    res.json(store.ticksBetween(req.params.id, from, to, Number(req.query.limit || 1000)));
  }));
  router.get('/history/:id/report', wrap(async (req, res) => {
    const r = store.latestReport(req.params.id);
    return r ? res.json(r) : res.status(404).json({ error: 'no stored report yet' });
  }));
  router.get('/incident/:eventId', wrap(async (req, res) => {
    const msgs = store.eventsForIncident(req.params.eventId);
    return msgs.length ? res.json(msgs) : res.status(404).json({ error: 'unknown incident' });
  }));
  router.post('/ingest', wrap(async (req, res) => res.json(await client.ingest(req.body))));
  router.get('/health', wrap(async (_req, res) => {
    let engine = null;
    try { engine = await client.health(); } catch (err) { engine = { status: 'UNREACHABLE', error: String(err.message) }; }
    res.json({ engine, poller: poller ? poller.stats : null });
  }));
  return router;
}

module.exports = { createEngineRouter };
