const axios = require('axios');
const db = require('./db');

const ENGINE_URL = (process.env.HEALTH_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const BACKEND_URL = `http://127.0.0.1:${process.env.PORT || 4000}`;
const POLL_INTERVAL_MS = 5000;
const PAGE_LIMIT = 100;

const ALLOWED_EVENTS = new Set([
    'HEALTH_REVIEW_REQUIRED',
    'HEALTH_EVENT_ESCALATED',
    'HEALTH_EVENT_RESOLVED'
]);

let timer = null;
let polling = false;

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

async function saveProgress(instanceId, sequence, event) {
    // Receipt is saved before the cursor. If the process stops between
    // these operations, the next poll can safely resume without reposting.
    if (event) {
        await dbRun(
            `INSERT OR IGNORE INTO engine_event_receipts
             (emission_id, engine_instance_id, sequence, event_id, event_type, processed_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                event.emission_id,
                instanceId,
                event.sequence,
                event.event_id,
                event.event_type,
                new Date().toISOString()
            ]
        );
    }

    await dbRun(
        `INSERT INTO engine_sync_state
         (id, engine_instance_id, next_since_seq, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            engine_instance_id = excluded.engine_instance_id,
            next_since_seq = excluded.next_since_seq,
            updated_at = excluded.updated_at`,
        [instanceId, sequence, new Date().toISOString()]
    );
}

async function bootstrap() {
    let state = await dbGet(
        'SELECT engine_instance_id, next_since_seq FROM engine_sync_state WHERE id = 1'
    );

    if (state) {
        console.log(
            `[Engine Sync] Resuming instance ${state.engine_instance_id} at sequence ${state.next_since_seq}`
        );
        return state;
    }

    const response = await axios.get(`${ENGINE_URL}/api/v1/events/feed`, {
        params: { since_seq: 0, limit: 1 },
        timeout: 10000
    });

    const feed = response.data || {};
    if (!feed.engine_instance_id || !Number.isInteger(feed.last_sequence)) {
        throw new Error('Invalid Engine Feed response during bootstrap');
    }

    // First installation: skip events already present in the feed.
    await dbRun(
        `INSERT OR IGNORE INTO engine_sync_state
         (id, engine_instance_id, next_since_seq, updated_at)
         VALUES (1, ?, ?, ?)`,
        [feed.engine_instance_id, feed.last_sequence, new Date().toISOString()]
    );

    state = await dbGet(
        'SELECT engine_instance_id, next_since_seq FROM engine_sync_state WHERE id = 1'
    );

    console.log(
        `[Engine Sync] Initial cursor set to ${state.next_since_seq} for instance ${state.engine_instance_id}`
    );

    return state;
}

function validateEvent(event, instanceId) {
    if (!event || typeof event !== 'object') {
        throw new Error('Feed contains an invalid event');
    }

    if (!ALLOWED_EVENTS.has(event.event_type)) {
        throw new Error(`Unsupported event type: ${event.event_type}`);
    }

    if (
        !event.event_id ||
        !event.emission_id ||
        !event.astronaut_id ||
        !event.engine_instance_id ||
        event.engine_instance_id !== instanceId ||
        !Number.isInteger(event.sequence) ||
        event.sequence < 1 ||
        !event.event ||
        !event.event.severity
    ) {
        throw new Error(`Invalid event envelope at sequence ${event.sequence}`);
    }
}

async function processEvent(event, instanceId) {
    validateEvent(event, instanceId);

    const receipt = await dbGet(
        'SELECT emission_id FROM engine_event_receipts WHERE engine_instance_id = ? AND emission_id = ?',
        [instanceId, event.emission_id]
    );

    if (!receipt) {
        const response = await axios.post(
            `${BACKEND_URL}/api/v1/incidents/upsert`,
            event,
            {
                headers: {
                    'x-api-key': process.env.API_KEY
                },
                timeout: 15000
            }
        );

        if (
            !response.data ||
            !response.data.incident_id ||
            response.data.event_id !== event.event_id
        ) {
            throw new Error(`Backend did not confirm event ${event.event_id}`);
        }

        console.log(
            `[Engine Sync] Processed ${event.event_type}: ${event.event_id} (seq ${event.sequence})`
        );
    } else {
        console.log(
            `[Engine Sync] Existing receipt; skipping duplicate ${event.emission_id}`
        );
    }

    await saveProgress(instanceId, event.sequence, event);
}

async function pollOnce() {
    if (polling) return;
    polling = true;

    try {
        if (!process.env.API_KEY) {
            throw new Error('API_KEY is not configured');
        }

        let state = await dbGet(
            'SELECT engine_instance_id, next_since_seq FROM engine_sync_state WHERE id = 1'
        );

        if (!state) {
            state = await bootstrap();
        }

        const response = await axios.get(`${ENGINE_URL}/api/v1/events/feed`, {
            params: {
                since_seq: state.next_since_seq,
                engine_instance_id: state.engine_instance_id,
                limit: PAGE_LIMIT
            },
            timeout: 10000
        });

        const feed = response.data || {};
        if (!feed.engine_instance_id || !Array.isArray(feed.events)) {
            throw new Error('Invalid Engine Feed response');
        }

        if (
            feed.instance_changed ||
            feed.engine_instance_id !== state.engine_instance_id
        ) {
            console.warn(
                `[Engine Sync] Engine instance changed to ${feed.engine_instance_id}; restarting cursor`
            );

            await saveProgress(feed.engine_instance_id, 0, null);
        }

        for (const event of feed.events) {
            await processEvent(event, feed.engine_instance_id);
        }

        if (feed.events.length === 0 || !feed.has_more) {
            const latest = await dbGet(
                'SELECT engine_instance_id, next_since_seq FROM engine_sync_state WHERE id = 1'
            );

            if (
                latest &&
                latest.engine_instance_id === feed.engine_instance_id &&
                Number.isInteger(feed.next_since_seq) &&
                feed.next_since_seq > latest.next_since_seq
            ) {
                await saveProgress(
                    feed.engine_instance_id,
                    feed.next_since_seq,
                    null
                );
            }
        }
    } catch (err) {
        console.error(
            '[Engine Sync] Poll failed:',
            err.response?.data || err.message
        );
    } finally {
        polling = false;
    }
}

function startEngineSyncWorker() {
    if (timer) return;

    console.log('[Engine Sync] Worker starting...');

    // pollOnce handles bootstrap itself and prevents overlapping polls.
    pollOnce();

    timer = setInterval(pollOnce, POLL_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
}
module.exports = { startEngineSyncWorker };
