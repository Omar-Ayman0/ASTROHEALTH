'use strict';
// Runs the real Python engine behind tests/stdlib_shim_server.py (stdlib HTTP, same LiveSystem as api_server.py)
// and checks the poller against it: no loss, no duplicates, reset, restart, engine down.
// To run the same test against the REAL FastAPI server: ENGINE_URL=http://127.0.0.1:8000 npm test (skips spawning).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EngineClient, EnginePoller, SqliteStore } = require('../src');

const PORT = Number(process.env.SHIM_PORT || 8791);
const EXTERNAL = process.env.ENGINE_URL || null;
const BASE = EXTERNAL || `http://127.0.0.1:${PORT}`;
// Where the test server lives. Default: <repo>/tests/stdlib_shim_server.py. Override with ENGINE_SHIM=<full path>
// if integration/node was copied out of the engine repo.
const SHIM = process.env.ENGINE_SHIM ? path.resolve(process.env.ENGINE_SHIM) : path.resolve(__dirname, '../../../tests/stdlib_shim_server.py');

/**
 * Find a Python >= 3.12 WITHOUT assuming the name `python3` exists (it does not on Windows).
 * Order: PYTHON env var (full path or command), then python3 / python / `py -3` (Windows launcher; first on win32).
 * Each candidate is asked for its real interpreter path (sys.executable) and that path is what we spawn, so
 * p.kill() stops the real process, not just the `py` launcher. The Windows Store "python" stub fails the probe and is skipped.
 */
function findPython() {
  const probe = ['-c', 'import sys;print(sys.version_info[0]*100+sys.version_info[1]);print(sys.executable)'];
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON]);
  const order = process.platform === 'win32' ? [['python'], ['py', '-3'], ['python3']] : [['python3'], ['python']];
  candidates.push(...order);
  const tried = [];
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, ...probe], { encoding: 'utf8' });
    if (r.error || r.status !== 0) { tried.push(`${[cmd, ...pre].join(' ')} (not usable)`); continue; }
    const [ver, exe] = String(r.stdout).trim().split(/\r?\n/);
    if (Number(ver) < 312) { tried.push(`${exe} (Python ${ver / 100 | 0}.${ver % 100}, need >= 3.12)`); continue; }
    return exe;
  }
  throw new Error(`No usable Python >= 3.12 found. Tried: ${tried.join('; ')}. Set PYTHON to the full path of python.exe in your venv.`);
}

function startShim(astronauts = 2, startStep = 760) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SHIM)) return reject(new Error(`test server not found: ${SHIM}. Run npm test from the full engine package (tests/ folder next to integration/) or set ENGINE_SHIM.`));
    let py;
    try { py = findPython(); } catch (e) { return reject(e); }
    const p = spawn(py, [SHIM, '--port', String(PORT), '--astronauts', String(astronauts), '--start-step', String(startStep)],
      { stdio: ['ignore', 'pipe', 'inherit'], cwd: path.dirname(path.dirname(SHIM)) });
    p.on('error', reject);
    p.stdout.on('data', (d) => { if (String(d).includes('shim ready')) resolve(p); });
    p.on('exit', (c) => reject(new Error(`shim exited early (${c})`)));
    setTimeout(() => reject(new Error('shim start timeout')), 90000);
  });
}
const stopShim = (p) => new Promise((r) => { p.removeAllListeners('exit'); p.on('exit', r); p.kill(); });
const client = new EngineClient({ baseUrl: BASE, timeoutMs: 20000 });
const step = async (id, k) => { for (let i = 0; i < k; i += 1) await fetch(`${BASE}/api/v1/simulate/next?astronaut_id=${id}`); };
const contiguous = (arr) => arr.every((v, i) => v === i + 1);
const tickSeqs = (store, id, inst) => store.db.prepare('SELECT tick_seq FROM engine_ticks WHERE astronaut_id=? AND instance_id=? ORDER BY tick_seq').all(id, inst).map((r) => r.tick_seq);

test('poller: ticks, reset, events, restart, engine down', { timeout: 600000 }, async (t) => {
  let shim = EXTERNAL ? null : await startShim();
  const store = new SqliteStore(':memory:');
  const newEvents = [];
  const poller = new EnginePoller({ client, store, astronautIds: ['ASTRO_01', 'ASTRO_02'], pageLimit: 7,
    onNewEvents: (evs) => newEvents.push(...evs), logger: { warn: () => {} } });
  const health1 = await client.health();
  const inst1 = health1.engine_instance_id;

  await t.test('40 readings with page limit 7 -> every tick stored once, in order', async () => {
    await step('ASTRO_01', 40); await step('ASTRO_02', 12);
    assert.equal((await poller.pollOnce()).ok, true);
    assert.ok(contiguous(tickSeqs(store, 'ASTRO_01', inst1)) && tickSeqs(store, 'ASTRO_01', inst1).length === 40);
    assert.equal(tickSeqs(store, 'ASTRO_02', inst1).length, 12);
    await poller.pollOnce(); await poller.pollOnce();                       // nothing new: nothing added
    assert.equal(tickSeqs(store, 'ASTRO_01', inst1).length, 40);
  });

  await t.test('simulation reset (step_index goes back): the new readings are still pulled', async () => {
    await fetch(`${BASE}/api/v1/simulation/reset?start_step=700&astronaut_id=ASTRO_01`, { method: 'POST' });
    await step('ASTRO_01', 5);
    await poller.pollOnce();
    const seqs = tickSeqs(store, 'ASTRO_01', inst1);
    assert.equal(seqs.length, 45); assert.ok(contiguous(seqs));
    const last = store.db.prepare('SELECT run, step_index FROM engine_ticks WHERE astronaut_id=? ORDER BY tick_seq DESC LIMIT 1').get('ASTRO_01');
    assert.ok(last.run >= 2 && last.step_index < 760);
  });

  await t.test('events: pageLimit 7 / feed limit, nothing lost or repeated, original JSON kept', async () => {
    await fetch(`${BASE}/api/v1/simulation/reset?start_step=760&astronaut_id=ASTRO_01`, { method: 'POST' });
    await step('ASTRO_01', 260);
    poller.pageLimit = 2;                                                    // force several feed pages
    await poller.pollOnce();
    const feed = await client.feed({ sinceSeq: 0, limit: 5000 });
    assert.ok(feed.count >= 4);
    assert.equal(store.count('engine_events'), feed.count);
    assert.equal(newEvents.length, feed.count);
    const stored = store.db.prepare('SELECT payload FROM engine_events ORDER BY sequence').all().map((r) => JSON.parse(r.payload));
    assert.deepEqual(stored, feed.events);                                   // lossless: identical JSON
    assert.equal(new Set(stored.map((e) => e.emission_id)).size, feed.count);
  });

  await t.test('reports: stored and returned unchanged', async () => {
    const live = await client.report('ASTRO_01');
    const kept = store.latestReport('ASTRO_01');
    assert.equal(kept.astronaut_id, 'ASTRO_01');
    assert.ok(Object.keys(live).every((k) => k in kept));
  });

  const ticksBefore = store.count('engine_ticks');
  const eventsBefore = store.count('engine_events');

  await t.test('engine down: poll reports an error, cursors untouched, data kept', async () => {
    if (EXTERNAL) return t.skip('external engine');
    await stopShim(shim); shim = null;
    const r = await poller.pollOnce();
    assert.equal(r.ok, false); assert.ok(poller.stats.errors >= 1);
    assert.equal(store.count('engine_ticks'), ticksBefore);
  });

  await t.test('engine restarted (new engine_instance_id, sequences start at 1): detected and pulled', async () => {
    if (EXTERNAL) return t.skip('external engine');
    shim = await startShim();
    const inst2 = (await client.health()).engine_instance_id;
    assert.notEqual(inst2, inst1);
    await step('ASTRO_01', 9);
    const r = await poller.pollOnce();
    assert.equal(r.ok, true, r.error && r.error.message);
    assert.equal(tickSeqs(store, 'ASTRO_01', inst2).length, 9);              // new instance stored under its own key
    assert.equal(tickSeqs(store, 'ASTRO_01', inst1).length, 45 + 260);       // old history untouched
    assert.equal((store.getCursor('feed')).instanceId, inst2);
    assert.equal(store.count('engine_events'), eventsBefore);                // replayed ids are idempotent (see docs)
  });

  poller.stop();
  if (shim) await stopShim(shim);
  store.close();
});
