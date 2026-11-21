const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');



const axios = require('axios');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// API Key Authentication for integration endpoints
const crypto = require('crypto');

function requireApiKey(req, res, next) {
    const expected = process.env.API_KEY || '';
    const received = req.get('x-api-key') || '';

    if (!expected) {
        return res.status(503).json({ error: 'API authentication is not configured' });
    }

    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);

    if (
        expectedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
        return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }

    next();
}

// Deliver queued health alerts to n8n every 30 seconds.
let healthAlertDispatchRunning = false;

function dispatchPendingHealthAlerts() {
    const webhookUrl = process.env.HEALTH_ALERT_WEBHOOK_URL;
    if (!webhookUrl || healthAlertDispatchRunning) return;

    healthAlertDispatchRunning = true;
    db.all(
        'SELECT event_id, payload_json FROM health_alert_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT 50',
        [],
        async (err, rows) => {
            if (err) {
                console.error('[Health Alert] Queue read error:', err.message);
                healthAlertDispatchRunning = false;
                return;
            }

            try {
                for (const row of rows) {
                    try {
                        const response = await axios.post(webhookUrl, JSON.parse(row.payload_json), {
                            headers: {
                                'Content-Type': 'application/json',
                                'x-api-key': process.env.API_KEY || ''
                            },
                            timeout: 10000
                        });

                        if (!response.data || response.data.accepted !== true || response.data.event_id !== row.event_id) {
                            throw new Error('Invalid n8n acknowledgement: accepted/event_id mismatch');
                        }

                        await new Promise((resolve, reject) => {
                            db.run(
                                'UPDATE health_alert_outbox SET delivered_at = ? WHERE event_id = ?',
                                [new Date().toISOString(), row.event_id],
                                err => err ? reject(err) : resolve()
                            );
                        });
                        console.log('[Health Alert] Delivered:', row.event_id);
                    } catch (sendError) {
                        console.error('[Health Alert] Delivery failed:', row.event_id, {
                            status: sendError.response?.status || null,
                            response: sendError.response?.data || null,
                            message: sendError.message
                        });
                    }
                }
            } finally {
                healthAlertDispatchRunning = false;
            }
        }
    );
}

const healthAlertDispatchTimer = setInterval(dispatchPendingHealthAlerts, 30000);
if (healthAlertDispatchTimer.unref) healthAlertDispatchTimer.unref();

// Trigger anomaly simulation
router.post('/simulation/trigger-anomaly', requireRole('admin'), async (req, res) => {
    try {
        const response = await axios.post(
            `${ML_SERVICE_URL}/simulation/trigger-anomaly`
        );

        res.json(response.data);

    } catch (error) {
        console.error('Anomaly trigger error:', error.message);

        res.status(503).json({
            success: false,
            error: 'ML Service is unavailable'
        });
    }
});



















// Send Emergency Message (Astronaut -> Doctor)
router.post('/emergency/send', requireRole('astronaut'), (req, res) => {
    const { content } = req.body;
    const timestamp = new Date().toISOString();
    const astronautId = req.session.user.astronaut_id;

    const sql = `INSERT INTO messages (sender_role, receiver_role, content, timestamp, status, astronaut_id) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, ['Astronaut', 'Doctor', content, timestamp, 'sent', astronautId], function (err) {
        if (err) return res.status(500).json({ error: err.message });

        // Emit socket event if needed (handled in server.js usually, but we can just save here)
        res.json({ id: this.lastID, status: 'sent' });
    });
});

// Send Precaution (Doctor -> Astronaut)
router.post('/precaution/send', requireRole('doctor', 'admin'), (req, res) => {
    const { content } = req.body;
    const timestamp = new Date().toISOString();
    const astronautId = req.body.astronaut_id;
    if (!/^ASTRO_0[1-4]$/.test(astronautId || '')) {
        return res.status(400).json({ error: 'Valid astronaut_id is required' });
    }

    const sql = `INSERT INTO messages (sender_role, receiver_role, content, timestamp, status, astronaut_id) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, ['Doctor', 'Astronaut', content, timestamp, 'sent', astronautId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, status: 'sent' });
    });
});

// Get Message History
router.delete('/messages/clear', requireRole('doctor', 'admin'), (req, res) => {
    db.run('DELETE FROM messages', [], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, deleted: this.changes });
    });
});
router.get('/messages/history', requireAuth, (req, res) => {
    const isAstronaut = req.session.user.role === 'astronaut';
    const sql = isAstronaut
        ? `SELECT * FROM messages WHERE astronaut_id = ? ORDER BY timestamp DESC LIMIT 50`
        : `SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50`;
    const params = isAstronaut ? [req.session.user.astronaut_id] : [];
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Resolve Emergency
router.post('/emergency/resolve', requireRole('doctor', 'admin'), (req, res) => {
    const { message_id } = req.body;
    const sql = `UPDATE messages SET status = 'resolved' WHERE id = ?`;
    db.run(sql, [message_id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'resolved' });
    });
});

// Get Vitals History
router.get('/vitals/history', requireAuth, (req, res) => {
    if (req.session.user.role === 'astronaut') return res.json([]);
    const limit = req.query.limit || 100;
    const sql = `SELECT * FROM vitals_log ORDER BY timestamp DESC LIMIT ?`;
    db.all(sql, [limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Return in ascending order for charts
        res.json(rows.reverse());
    });
});



// --- Task Routes ---

// Get All Tasks
router.get('/tasks', requireAuth, (req, res) => {
    const sql = `SELECT * FROM tasks ORDER BY id ASC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(t => ({ ...t, completed: !!t.completed })));
    });
});

// Add Task
router.post('/tasks', requireAuth, (req, res) => {
    const { text, type } = req.body;
    const timestamp = new Date().toISOString();
    const taskType = type || 'personal';
    const sql = `INSERT INTO tasks (text, completed, timestamp, type) VALUES (?, 0, ?, ?)`;
    db.run(sql, [text, timestamp, taskType], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, text, completed: false, timestamp, type: taskType });
    });
});

// Toggle Task Completion
router.put('/tasks/:id', requireAuth, (req, res) => {
    const { completed } = req.body;
    const sql = `UPDATE tasks SET completed = ? WHERE id = ?`;
    db.run(sql, [completed ? 1 : 0, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: req.params.id, completed });
    });
});

// Delete Task
router.delete('/tasks/:id', requireAuth, (req, res) => {
    const sql = `DELETE FROM tasks WHERE id = ?`;
    db.run(sql, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted', id: req.params.id });
    });
});

// --- Health Engine Read APIs ---
const HEALTH_ENGINE_URL = process.env.HEALTH_ENGINE_URL || 'http://127.0.0.1:8001';

router.get('/v1/report', requireApiKey, async (req, res) => {
    try {
        const response = await axios.get(`${HEALTH_ENGINE_URL}/api/v1/report`, {
            params: { astronaut_id: req.query.astronaut_id || 'ASTRO_01' },
            timeout: 15000
        });
        res.json(response.data);
    } catch (error) {
        console.error('Health report fetch error:', error.message);
        res.status(error.response?.status || 503).json({
            success: false,
            error: 'Health Engine report is unavailable'
        });
    }
});

router.get('/v1/events', requireApiKey, async (req, res) => {
    try {
        const params = {};
        if (req.query.astronaut_id) params.astronaut_id = req.query.astronaut_id;
        if (req.query.review_only !== undefined) params.review_only = req.query.review_only;

        const response = await axios.get(`${HEALTH_ENGINE_URL}/api/v1/events`, {
            params,
            timeout: 15000
        });
        res.json(response.data);
    } catch (error) {
        console.error('Health events fetch error:', error.message);
        res.status(error.response?.status || 503).json({
            success: false,
            error: 'Health Engine events are unavailable'
        });
    }
});


// WF01 local demo trigger - API key stays on backend
router.post('/doctor/workflows/wf01/test', requireRole('doctor', 'admin'), async (req, res) => {
    const remote = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
        return res.status(403).json({ success: false, error: 'Local access only' });
    }

    const astronautId = String(req.body?.astronaut_id || '').trim();
    if (!astronautId) {
        return res.status(400).json({ success: false, error: 'astronaut_id is required' });
    }

    const now = new Date().toISOString();
    const eventId = `WF01-DEMO-${Date.now()}`;

    const payload = {
        schema_version: '1.0',
        event_type: 'HEALTH_REVIEW_REQUIRED',
        event_id: eventId,
        astronaut_id: astronautId,
        emission_id: `EMIT-${eventId}`,
        engine_instance_id: 'ASTROHEALTH-DEMO',
        run: 1,
        sequence: Date.now(),
        emitted_at: now,
        created_at: now,
        timestamp: now,
        needs_human_review: true,
        anomaly_score: 0.85,
        severity: 'MEDIUM',
        explanation: 'Synthetic WF01 integration test - not real medical data.',
        event: {
            event_id: eventId,
            astronaut_id: astronautId,
            needs_human_review: true,
            severity: 'MEDIUM',
            anomaly_score: 0.85,
            explanation: 'Synthetic WF01 integration test.',
            timestamp: now,
            created_at: now
        }
    };

    try {
        const response = await axios.post(
            `http://127.0.0.1:${process.env.PORT || 4000}/api/v1/incidents/upsert`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.API_KEY || ''
                },
                timeout: 15000
            }
        );

        return res.status(response.status).json({
            success: true,
            queued: true,
            event_id: eventId,
            incident_id: response.data?.incident_id,
            message: 'WF01 event accepted and queued for n8n delivery.'
        });
    } catch (error) {
        return res.status(error.response?.status || 502).json({
            success: false,
            error: error.response?.data?.error || error.message
        });
    }
});


// WF05: Create triage job and initial escalation
function createWf05Tasks(incidentId, now, callback) {
    const delayMinutes = Math.max(1, Number.parseInt(process.env.WF05_REMINDER_DELAY_MINUTES || "5", 10) || 5);
    const dueAt = new Date(Date.now() + delayMinutes * 60000).toISOString();

    db.run(
        "INSERT OR IGNORE INTO incident_triage_jobs (incident_id, status, created_at, updated_at) VALUES (?, 'PENDING', ?, ?)",
        [incidentId, now, now],
        (err) => {
            if (err) return callback(err);
            db.run(
                "INSERT OR IGNORE INTO incident_escalations (incident_id, status, stage, due_at, reminder_count, created_at, updated_at) VALUES (?, 'ACTIVE', 'REMINDER_1', ?, 0, ?, ?)",
                [incidentId, dueAt, now, now],
                callback
            );
        }
    );
}

// --- Incident Integration APIs ---

// Register or update an incident received from the Health Engine / n8n
router.post('/v1/incidents/upsert', requireApiKey, (req, res) => {
    const body = req.body || {};
    const event = body.event || {};

    const eventId = body.event_id || event.event_id;
    const astronautId = body.astronaut_id || event.astronaut_id;
    const severity = event.severity;
    const eventType = body.event_type || event.event_type;
    const isResolved = eventType === 'HEALTH_EVENT_RESOLVED';
    const engineStatus = isResolved ? 'RESOLVED' : 'ACTIVE';

    if (!eventId || !astronautId || !severity) {
        return res.status(400).json({
            success: false,
            error: 'event_id, astronaut_id and event.severity are required'
        });
    }

    const now = new Date().toISOString();
    const createdAt = body.created_at || now;
    const source = body.data_source?.type || body.source || 'health_engine';
    const payloadJson = JSON.stringify(body);

    db.get(
        'SELECT * FROM incidents WHERE event_id = ?',
        [eventId],
        (err, existing) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (existing) {
                const nextStatus = existing.status;
                db.run(
                    `UPDATE incidents
                     SET astronaut_id = ?, severity = ?, updated_at = ?,
                         source = ?, payload_json = ?, engine_status = ?
                     WHERE event_id = ?`,
                    [astronautId, severity, now, source, payloadJson, engineStatus, eventId],
                    function (updateErr) {
                        if (updateErr) {
                            return res.status(500).json({ error: updateErr.message });
                        }

                        const respondSuccess = () => res.json({
                            incident_id: existing.incident_id,
                            event_id: eventId,
                            astronaut_id: astronautId,
                            status: nextStatus,
                            engine_status: engineStatus,
                            severity,
                            created_at: existing.created_at,
                            updated_at: now,
                            assigned_role: existing.assigned_role,
                            source
                        });

                        if (eventType === 'HEALTH_REVIEW_REQUIRED') {
                            db.run(
                                'INSERT OR IGNORE INTO health_alert_outbox (event_id, payload_json, created_at) VALUES (?, ?, ?)',
                                [eventId, payloadJson, now],
                                (queueErr) => {
                                    if (queueErr) {
                                        console.error('[Health Alert] Queue insert error:', queueErr.message);
                                        return res.status(500).json({ success: false, error: 'Failed to queue health alert' });
                                    }
                                    createWf05Tasks(existing.incident_id, now, (wf05Err) => {
                                        if (wf05Err) {
                                            console.error('[WF05]', wf05Err.message);
                                            return res.status(500).json({ success: false, error: 'WF05 task creation failed' });
                                        }
                                        return respondSuccess();
                                    });
                                }
                            );
                            return;
                        }

                        return respondSuccess();
                    }
                );
                return;
            }

            if (isResolved) {
                return res.status(404).json({
                    success: false,
                    error: 'Cannot resolve an incident that does not exist',
                    event_id: eventId
                });
            }

            const temporaryId = `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            db.run(
                `INSERT INTO incidents
                 (incident_id, event_id, astronaut_id, status, severity,
                  created_at, updated_at, assigned_role, source, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    temporaryId,
                    eventId,
                    astronautId,
                    'PENDING_MEDICAL_REVIEW',
                    severity,
                    createdAt,
                    now,
                    'MEDICAL_OFFICER',
                    source,
                    payloadJson
                ],
                function (insertErr) {
                    if (insertErr) {
                        if (insertErr.code === 'SQLITE_CONSTRAINT' ||
                            insertErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                            return db.get(
                                'SELECT * FROM incidents WHERE event_id = ?',
                                [eventId],
                                (lookupErr, duplicate) => {
                                    if (lookupErr || !duplicate) {
                                        return res.status(500).json({
                                            error: lookupErr?.message || insertErr.message
                                        });
                                    }
                    
                                    db.run(
                                        `UPDATE incidents
                                         SET astronaut_id = ?, severity = ?, updated_at = ?,
                                             source = ?, payload_json = ?, engine_status = ?
                                         WHERE event_id = ?`,
                                        [astronautId, severity, now, source, payloadJson, engineStatus, eventId],
                                        function (updateErr) {
                                            if (updateErr) {
                                                return res.status(500).json({ error: updateErr.message });
                                            }
                    
                                            const respond = () => res.json({
                                                success: true,
                                                duplicate: true,
                                                incident_id: duplicate.incident_id,
                                                event_id: eventId,
                                                astronaut_id: astronautId,
                                                status: duplicate.status,
                                                engine_status: engineStatus,
                                                severity,
                                                created_at: duplicate.created_at,
                                                updated_at: now,
                                                assigned_role: duplicate.assigned_role,
                                                source
                                            });
                    
                                            if (eventType === 'HEALTH_REVIEW_REQUIRED') {
                                                return db.run(
                                                    'INSERT OR IGNORE INTO health_alert_outbox (event_id, payload_json, created_at) VALUES (?, ?, ?)',
                                                    [eventId, payloadJson, now],
                                                    queueErr => {
                                                        if (queueErr) {
                                                            return res.status(500).json({ error: queueErr.message });
                                                        }
                                                        createWf05Tasks(duplicate.incident_id, now, (wf05Err) => {
                                                            if (wf05Err) {
                                                                console.error('[WF05]', wf05Err.message);
                                                                return res.status(500).json({ success: false, error: 'WF05 task creation failed' });
                                                            }
                                                            respond();
                                                        });
                                                    }
                                                );
                                            }
                    
                                            respond();
                                        }
                                    );
                                }
                            );
                        }
                    
                        return res.status(500).json({ error: insertErr.message });
                    }

                    const incidentId = `INC-${String(this.lastID).padStart(4, '0')}`;

                    db.run(
                        'UPDATE incidents SET incident_id = ? WHERE id = ?',
                        [incidentId, this.lastID],
                        (finalErr) => {
                            if (finalErr) {
                                return res.status(500).json({ error: finalErr.message });
                            }

                            if (eventType === 'HEALTH_REVIEW_REQUIRED') {
                                db.run(
                                    'INSERT OR IGNORE INTO health_alert_outbox (event_id, payload_json, created_at) VALUES (?, ?, ?)',
                                    [eventId, JSON.stringify(body), now],
                                    (queueErr) => {
                                        if (queueErr) {
                                            console.error('[Health Alert] Queue insert error:', queueErr.message);
                                            return res.status(500).json({ success: false, error: 'Failed to queue health alert' });
                                        }
                                        createWf05Tasks(incidentId, now, (wf05Err) => {
    if (wf05Err) {
        console.error('[WF05]', wf05Err.message);
        return res.status(500).json({ success: false, error: 'WF05 task creation failed' });
    }
    return res.status(201).json({
                                            incident_id: incidentId,
                                            event_id: eventId,
                                            astronaut_id: astronautId,
                                            status: 'PENDING_MEDICAL_REVIEW',
                                            severity,
                                            created_at: createdAt,
                                            updated_at: now,
                                            assigned_role: 'MEDICAL_OFFICER',
                                            source
                                        });
});
                                    }
                                );
                                return;
                            }

                            return res.status(201).json({
                                incident_id: incidentId,
                                event_id: eventId,
                                astronaut_id: astronautId,
                                status: 'PENDING_MEDICAL_REVIEW',
                                engine_status: 'ACTIVE',
                                severity,
                                created_at: createdAt,
                                updated_at: now,
                                assigned_role: 'MEDICAL_OFFICER',
                                source
                            });
                        }
                    );
                }
            );
        }
    );
});

// Get incidents, optionally filtered by astronaut
router.get('/v1/incidents', requireApiKey, (req, res) => {
    const astronautId = req.query.astronaut_id;

    const sql = astronautId
        ? 'SELECT incident_id, event_id, astronaut_id, status, engine_status, severity, created_at, updated_at, assigned_role, source FROM incidents WHERE astronaut_id = ? ORDER BY created_at DESC'
        : 'SELECT incident_id, event_id, astronaut_id, status, engine_status, severity, created_at, updated_at, assigned_role, source FROM incidents ORDER BY created_at DESC';

    db.all(sql, astronautId ? [astronautId] : [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (astronautId) {
            return res.json({
                astronaut_id: astronautId,
                incidents: rows
            });
        }

        return res.json({ incidents: rows });
    });
});


// --- Incident Actions API ---
const INCIDENT_ACTION_TRANSITIONS = {
    ACKNOWLEDGE: {
        from: 'PENDING_MEDICAL_REVIEW',
        to: 'ACKNOWLEDGED'
    },
    START_REVIEW: {
        from: 'ACKNOWLEDGED',
        to: 'IN_REVIEW'
    },
    COMPLETE_REVIEW: {
        from: 'IN_REVIEW',
        to: 'REVIEW_COMPLETED'
    }
};

router.post('/v1/incidents/:incident_id/actions', requireApiKey, (req, res) => {
    const incidentId = req.params.incident_id;
    const { action, actor, reviewer_id, notes, request_id } = req.body || {};
    const transition = INCIDENT_ACTION_TRANSITIONS[action];
    const resolvedActor = actor || reviewer_id || null;

    if (!transition) {
        return res.status(400).json({
            success: false,
            error: 'Invalid action',
            allowed_actions: Object.keys(INCIDENT_ACTION_TRANSITIONS)
        });
    }

    if (!request_id) {
        return res.status(400).json({
            success: false,
            error: 'request_id is required for idempotency'
        });
    }

    db.serialize(() => {
        db.run('BEGIN IMMEDIATE', (beginErr) => {
            if (beginErr) {
                return res.status(500).json({ success: false, error: 'Could not start transaction' });
            }

            const rollback = (status, payload) => {
                db.run('ROLLBACK', () => res.status(status).json(payload));
            };

            db.get(
                'SELECT * FROM incident_actions WHERE request_id = ?',
                [request_id],
                (actionErr, previousAction) => {
                    if (actionErr) {
                        return rollback(500, { success: false, error: actionErr.message });
                    }

                    if (previousAction) {
                        return rollback(409, {
                            success: false,
                            error: 'request_id already used',
                            previous_action: previousAction
                        });
                    }

                    db.get(
                        'SELECT * FROM incidents WHERE incident_id = ?',
                        [incidentId],
                        (incidentErr, incident) => {
                            if (incidentErr) {
                                return rollback(500, { success: false, error: incidentErr.message });
                            }

                            if (!incident) {
                                return rollback(404, { success: false, error: 'Incident not found' });
                            }

                            if (incident.status !== transition.from) {
                                return rollback(409, {
                                    success: false,
                                    error: 'Invalid status transition',
                                    current_status: incident.status,
                                    required_status: transition.from
                                });
                            }

                            const now = new Date().toISOString();

                            db.run(
                                'UPDATE incidents SET status = ?, updated_at = ? WHERE incident_id = ? AND status = ?',
                                [transition.to, now, incidentId, transition.from],
                                function (updateErr) {
                                    if (updateErr || this.changes !== 1) {
                                        return rollback(409, {
                                            success: false,
                                            error: updateErr?.message || 'Incident status changed; retry'
                                        });
                                    }

                                    db.run(
                                        `INSERT INTO incident_actions
                                        (incident_id, action_type, previous_status, new_status, actor, notes, request_id, created_at)
                                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                        [incidentId, action, transition.from, transition.to, resolvedActor, notes || null, request_id, now],
                                        function (insertErr) {
                                            if (insertErr) {
                                                return rollback(500, { success: false, error: insertErr.message });
                                            }

                                            
                                            // WF05_ACK_ESCALATION_CANCEL
                                            const commitAction = () => {
                                                db.run('COMMIT', (commitErr) => {
                                                    if (commitErr) {
                                                        return rollback(500, { success: false, error: commitErr.message });
                                                    }

                                                    return res.json({
                                                        success: true,
                                                        request_id,
                                                        incident_id: incidentId,
                                                        astronaut_id: incident.astronaut_id,
                                                        action,
                                                        previous_status: transition.from,
                                                        new_status: transition.to,
                                                        status: transition.to,
                                                        persisted: true,
                                                        actor: resolvedActor,
                                                        created_at: now
                                                    });
                                                });
                                            };

                                            if (action === 'ACKNOWLEDGE') {
                                                db.run(
                                                    "UPDATE incident_escalations SET status = 'CANCELLED', cancelled_at = ?, updated_at = ? WHERE incident_id = ? AND status = 'ACTIVE'",
                                                    [now, now, incidentId],
                                                    (escalationErr) => {
                                                        if (escalationErr) {
                                                            return rollback(500, { success: false, error: escalationErr.message });
                                                        }
                                                        commitAction();
                                                    }
                                                );
                                            } else {
                                                commitAction();
                                            }
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        });
    });
});


// --- Workflow 02: AI Health Assistant ---
router.post('/v1/health-assistant', requireApiKey, async (req, res) => {
    const webhookUrl = process.env.HEALTH_ASSISTANT_WEBHOOK_URL;

    if (!webhookUrl) {
        return res.status(503).json({
            accepted: false,
            error: 'Health Assistant webhook is not configured'
        });
    }

    const body = req.body || {};
    const { schema_version, request_id, astronaut_id, request_type, question } = body;

    if (
        schema_version !== '1.0' ||
        typeof request_id !== 'string' ||
        !request_id.trim() ||
        request_id !== request_id.trim() ||
        request_id.length > 128 ||
        typeof astronaut_id !== 'string' ||
        !astronaut_id.trim() ||
        astronaut_id !== astronaut_id.trim() ||
        astronaut_id.length > 64 ||
        !['HEALTH_BRIEFING', 'QUESTION'].includes(request_type) ||
        (request_type === 'QUESTION' &&
            (typeof question !== 'string' ||
             !question.trim() ||
             question !== question.trim() ||
             question.length > 2000)) ||
        (question !== undefined && typeof question !== 'string')
    ) {
        return res.status(400).json({
            accepted: false,
            error: 'Invalid Health Assistant request'
        });
    }

    try {
        const response = await axios.post(webhookUrl, {
            schema_version,
            request_id,
            astronaut_id,
            request_type,
            question: question || ''
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 90000
        });

        return res.status(response.status).json(response.data);
    } catch (error) {
        console.error('Health Assistant delivery failed:', error.message);

        return res.status(502).json({
            accepted: false,
            request_id,
            error: 'Health Assistant service is unavailable'
        });
    }
});

// --- Workflow 04: Mission Connection ---
router.get('/v1/mission/connection', requireApiKey, (req, res) => {
    return res.json({
        local_monitoring: 'ONLINE',
        earth_connection: 'CONNECTED',
        pending_sync: 0,
        last_sync_at: null
    });
});


 
// Local Doctor AI Assistant - Workflow 02
router.post('/doctor/health-assistant', requireRole('doctor', 'admin'), async (req, res) => {
    const remoteAddress = req.ip || req.socket.remoteAddress;
    const allowedAddresses = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

    if (!allowedAddresses.includes(remoteAddress)) {
        return res.status(403).json({
            accepted: false,
            error: 'Local access only'
        });
    }

    const webhookUrl = process.env.HEALTH_ASSISTANT_WEBHOOK_URL;
    const { astronaut_id, question } = req.body || {};

    if (!webhookUrl) {
        return res.status(503).json({
            accepted: false,
            error: 'Health Assistant webhook is not configured'
        });
    }

    if (
        typeof astronaut_id !== 'string' ||
        !/^ASTRO_0[1-4]$/.test(astronaut_id) ||
        typeof question !== 'string' ||
        !question.trim() ||
        question.trim().length > 2000
    ) {
        return res.status(400).json({
            accepted: false,
            error: 'Invalid astronaut ID or question'
        });
    }

    const request_id = 'ASTRO-' + astronaut_id + '-QUESTION-' + Date.now();

    try {
        const response = await axios.post(webhookUrl, {
            schema_version: '1.0',
            request_id,
            astronaut_id,
            request_type: 'QUESTION',
            question: question.trim()
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 90000
        });

        return res.status(response.status).json(response.data);

    } catch (error) {
        console.error('Doctor AI Assistant failed:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });

        return res.status(502).json({
            accepted: false,
            request_id,
            error: 'Health Assistant service is unavailable'
        });
    }
});


// Doctor Dashboard: local incidents feed
router.get('/doctor/incidents', requireRole('doctor', 'admin'), (req, res) => {
    const ip = req.ip || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
        return res.status(403).json({ error: 'Local access only' });
    }

    const astronautId = req.query.astronaut_id;
    const sql = astronautId
        ? 'SELECT incident_id, event_id, astronaut_id, status, engine_status, severity, created_at, updated_at, assigned_role, source FROM incidents WHERE astronaut_id = ? ORDER BY created_at DESC'
        : 'SELECT incident_id, event_id, astronaut_id, status, engine_status, severity, created_at, updated_at, assigned_role, source FROM incidents ORDER BY created_at DESC';

    db.all(sql, astronautId ? [astronautId] : [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ incidents: rows || [] });
    });
});


// WF05: Manually queue triage for a doctor-selected incident
router.post('/doctor/incidents/:incident_id/wf05-trigger', requireRole('doctor', 'admin'), (req, res) => {
    const ip = req.ip || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
        return res.status(403).json({ success: false, error: 'Local access only' });
    }

    if (req.body?.schema_version !== '1.0') {
        return res.status(400).json({ success: false, error: 'schema_version 1.0 is required' });
    }

    const incidentId = req.params.incident_id;
    const now = new Date().toISOString();

    db.get(
        'SELECT incident_id, astronaut_id, triage_status FROM incidents WHERE incident_id = ?',
        [incidentId],
        (err, incident) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (!incident) return res.status(404).json({ success: false, error: 'Incident not found' });

            if (['COMPLETED', 'FALLBACK'].includes(String(incident.triage_status || '').toUpperCase())) {
                return res.status(409).json({
                    success: false,
                    error: 'Triage has already been completed for this incident',
                    triage_status: incident.triage_status
                });
            }

            db.get(
                'SELECT id, status FROM incident_triage_jobs WHERE incident_id = ? ORDER BY id DESC LIMIT 1',
                [incidentId],
                (jobErr, job) => {
                    if (jobErr) return res.status(500).json({ success: false, error: jobErr.message });

                    if (job && job.status === 'PENDING') {
                        return res.json({
                            success: true,
                            queued: true,
                            existing: true,
                            incident_id: incidentId,
                            job_id: job.id,
                            job_status: 'PENDING',
                            message: 'Triage job is already waiting in the queue'
                        });
                    }

                    if (job && job.status === 'PROCESSING') {
                        return res.status(409).json({
                            success: false,
                            error: 'Triage job is already processing',
                            job_status: job.status
                        });
                    }

                    if (job && job.status === 'COMPLETED') {
                        return res.status(409).json({
                            success: false,
                            error: 'Triage job has already been completed',
                            job_status: job.status
                        });
                    }

                    const done = (writeErr, jobId) => {
                        if (writeErr) {
                            return res.status(500).json({
                                success: false,
                                error: 'Failed to queue WF05',
                                details: writeErr.message
                            });
                        }

                        return res.json({
                            success: true,
                            queued: true,
                            incident_id: incidentId,
                            astronaut_id: incident.astronaut_id,
                            job_id: jobId,
                            job_status: 'PENDING',
                            schema_version: '1.0',
                            message: 'Triage job queued for the existing WF05 scheduler'
                        });
                    };

                    if (job && job.status === 'FAILED') {
                        db.run(
                            "UPDATE incident_triage_jobs SET status = 'PENDING', locked_at = NULL, completed_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?",
                            [now, job.id],
                            function (updateErr) {
                                done(updateErr, job.id);
                            }
                        );
                    } else if (!job) {
                        db.run(
                            "INSERT INTO incident_triage_jobs (incident_id, status, attempt_count, created_at, updated_at) VALUES (?, 'PENDING', 0, ?, ?)",
                            [incidentId, now, now],
                            function (insertErr) {
                                done(insertErr, this?.lastID);
                            }
                        );
                    } else {
                        return res.status(409).json({
                            success: false,
                            error: 'Unsupported triage job state',
                            job_status: job.status
                        });
                    }
                }
            );
        }
    );
});
// WF05: Doctor Dashboard notification status
router.get('/doctor/incidents/:incident_id/wf05-status', requireRole('doctor', 'admin'), (req, res) => {
    const ip = req.ip || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
        return res.status(403).json({ error: 'Local access only' });
    }

    const incidentId = req.params.incident_id;

    db.get(
        `SELECT i.incident_id, i.astronaut_id, i.severity, i.status,
                i.triage_status, i.triage_generated_at, i.triage_brief_json,
                (SELECT status FROM incident_triage_jobs
                 WHERE incident_id = i.incident_id ORDER BY id DESC LIMIT 1) AS job_status,
                (SELECT status FROM incident_escalations
                 WHERE incident_id = i.incident_id ORDER BY id DESC LIMIT 1) AS escalation_status,
                (SELECT stage FROM incident_escalations
                 WHERE incident_id = i.incident_id ORDER BY id DESC LIMIT 1) AS escalation_stage,
                (SELECT reminder_count FROM incident_escalations
                 WHERE incident_id = i.incident_id ORDER BY id DESC LIMIT 1) AS reminder_count
         FROM incidents i WHERE i.incident_id = ?`,
        [incidentId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Incident not found' });

            res.json({
                success: true,
                incident: row,
                triage: {
                    status: row.triage_status || row.job_status || 'NOT_CREATED',
                    generated_at: row.triage_generated_at,
                    brief: wf05ParseJson(row.triage_brief_json, null)
                },
                escalation: {
                    status: row.escalation_status,
                    stage: row.escalation_stage,
                    reminder_count: row.reminder_count || 0
                }
            });
        }
    );
});
// WF03 Incident Review Proxy
router.post('/doctor/incidents/:incident_id/actions', requireRole('doctor', 'admin'), async (req, res) => {
    const ip = req.ip || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
        return res.status(403).json({ error: 'Local access only' });
    }

    const webhookUrl = process.env.INCIDENT_REVIEW_WEBHOOK_URL;
    const apiKey = process.env.API_KEY;

    if (!webhookUrl || !apiKey) {
        return res.status(503).json({
            success: false,
            error: 'WF03 webhook or API authentication is not configured'
        });
    }

    const incidentId = req.params.incident_id;
    const action = req.body?.action;
    const allowedActions = ['ACKNOWLEDGE', 'START_REVIEW', 'COMPLETE_REVIEW'];

    if (!allowedActions.includes(action)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid incident action'
        });
    }

    db.get(
        'SELECT astronaut_id FROM incidents WHERE incident_id = ?',
        [incidentId],
        async (err, incident) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to read incident',
                    details: err.message
                });
            }

            if (!incident) {
                return res.status(404).json({
                    success: false,
                    error: 'Incident not found'
                });
            }

            if (!incident.astronaut_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Incident astronaut_id is missing'
                });
            }

            const payload = {
                schema_version: '1.0',
                request_id: req.body?.request_id ||
                    `WF03-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                incident_id: incidentId,
                astronaut_id: incident.astronaut_id,
                action,
                reviewer_id: 'MEDICAL_OFFICER_01',
                notes: req.body?.notes ?? ''
            };

            console.log(
                '[WF03] Outgoing request body:',
                JSON.stringify(payload)
            );

            try {
                const response = await axios.post(webhookUrl, payload, {
                    timeout: 30000,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey
                    }
                });

                return res.status(response.status).json(response.data);
            } catch (error) {
                console.error(
                    '[WF03] Webhook request failed:',
                    error.response?.data || error.message
                );

                return res.status(error.response?.status || 502).json(
                    error.response?.data || {
                        success: false,
                        error: 'Incident Review workflow failed',
                        details: error.message
                    }
                );
            }
        }
    );
});

 
// =====================================================
// WF05 TRIAGE APIs
// =====================================================

function wf05ParseJson(value, fallback = {}) {
    try {
        return typeof value === 'string' ? JSON.parse(value) : (value || fallback);
    } catch {
        return fallback;
    }
}

function wf05CollectEvidenceRefs(value, prefix, output = []) {
    if (value === null || value === undefined) return output;

    if (Array.isArray(value)) {
        value.forEach((item, index) =>
            wf05CollectEvidenceRefs(item, prefix + '[' + index + ']', output)
        );
    } else if (typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) =>
            wf05CollectEvidenceRefs(item, prefix + '.' + key, output)
        );
    } else {
        output.push(prefix);
    }

    return output;
}

async function wf05LoadTriageContext(incidentId) {
    const incident = await new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM incidents WHERE incident_id = ?',
            [incidentId],
            (err, row) => err ? reject(err) : resolve(row)
        );
    });

    if (!incident) return null;

    const eventPayload = wf05ParseJson(incident.payload_json, {});
    let engineReport = null;
    let engineEvents = [];

    try {
        const response = await axios.get(HEALTH_ENGINE_URL + '/api/v1/report', {
            params: { astronaut_id: incident.astronaut_id },
            timeout: 10000
        });
        engineReport = response.data;
    } catch (error) {
        console.warn('[WF05] Engine report unavailable:', error.message);
    }

    try {
        const response = await axios.get(HEALTH_ENGINE_URL + '/api/v1/events', {
            params: { astronaut_id: incident.astronaut_id },
            timeout: 10000
        });
        engineEvents = Array.isArray(response.data)
            ? response.data
            : (response.data?.events || []);
    } catch (error) {
        console.warn('[WF05] Engine events unavailable:', error.message);
    }

    const evidenceRefs = [
        ...wf05CollectEvidenceRefs(eventPayload, 'incident.payload'),
        ...wf05CollectEvidenceRefs(engineReport, 'engine_report'),
        ...wf05CollectEvidenceRefs(engineEvents, 'engine_events')
    ];

    return {
        incident: {
            incident_id: incident.incident_id,
            event_id: incident.event_id,
            astronaut_id: incident.astronaut_id,
            status: incident.status,
            engine_status: incident.engine_status,
            severity: incident.severity,
            created_at: incident.created_at,
            updated_at: incident.updated_at
        },
        event: eventPayload,
        engine_report: engineReport,
        engine_events: engineEvents,
        evidence_refs: [...new Set(evidenceRefs)]
    };
}

// 1. Ready triage jobs
router.get('/v1/triage/due', requireApiKey, (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

    db.all(
        "SELECT j.id AS job_id, j.incident_id, j.status AS job_status, " +
        "j.attempt_count, j.created_at, j.updated_at, " +
        "i.event_id, i.astronaut_id, i.severity, i.status AS incident_status " +
        "FROM incident_triage_jobs j " +
        "JOIN incidents i ON i.incident_id = j.incident_id " +
        "WHERE j.status IN ('PENDING', 'FAILED') " +
        "ORDER BY j.created_at ASC LIMIT ?",
        [limit],
        (err, rows) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to fetch due triage jobs',
                    details: err.message
                });
            }

            return res.json({
                success: true,
                count: rows.length,
                jobs: rows
            });
        }
    );
});

// 2. Incident context and available evidence
router.get('/v1/incidents/:incident_id/triage-context', requireApiKey, async (req, res) => {
    try {
        const context = await wf05LoadTriageContext(req.params.incident_id);

        if (!context) {
            return res.status(404).json({
                success: false,
                error: 'Incident not found'
            });
        }

        return res.json({
            success: true,
            context
        });
    } catch (error) {
        console.error('[WF05] Triage context error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to load triage context'
        });
    }
});

// 3. Validate and save AI triage brief
router.post('/v1/incidents/:incident_id/triage-brief', requireApiKey, async (req, res) => {
    const body = req.body || {};
    const requiredFields = [
        'summary', 'findings', 'evidence_refs',
        'suggested_checks', 'confidence', 'limitations', 'request_id'
    ];

    const missing = requiredFields.filter(key =>
        body[key] === undefined || body[key] === null
    );

    if (missing.length) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields',
            missing
        });
    }

    if (!Array.isArray(body.evidence_refs) ||
        !Array.isArray(body.findings) ||
        !Array.isArray(body.suggested_checks) ||
        !Array.isArray(body.limitations)) {
        return res.status(400).json({
            success: false,
            error: 'findings, evidence_refs, suggested_checks and limitations must be arrays'
        });
    }

    if (typeof body.confidence !== 'number' ||
        body.confidence < 0 || body.confidence > 1) {
        return res.status(400).json({
            success: false,
            error: 'confidence must be a number between 0 and 1'
        });
    }

    if (typeof body.summary !== 'string' || !body.summary.trim()) {
        return res.status(400).json({
            success: false,
            error: 'summary must be a non-empty string'
        });
    }

    try {
        const context = await wf05LoadTriageContext(req.params.incident_id);

        if (!context) {
            return res.status(404).json({
                success: false,
                error: 'Incident not found'
            });
        }

        const allowedRefs = new Set(context.evidence_refs);
        const invalidRefs = body.evidence_refs.filter(ref =>
            typeof ref !== 'string' || !allowedRefs.has(ref)
        );

        if (invalidRefs.length) {
            return res.status(400).json({
                success: false,
                error: 'One or more evidence_refs do not exist in incident context',
                invalid_evidence_refs: invalidRefs
            });
        }

        const now = new Date().toISOString();
        const briefStatus = body.brief_type === 'FALLBACK' ||
            body.status === 'FALLBACK' ? 'FALLBACK' : 'COMPLETED';

        const brief = {
            summary: body.summary,
            findings: body.findings,
            evidence_refs: body.evidence_refs,
            suggested_checks: body.suggested_checks,
            confidence: body.confidence,
            limitations: body.limitations,
            request_id: String(body.request_id),
            status: briefStatus,
            generated_at: now
        };

        db.serialize(() => {
            db.run('BEGIN IMMEDIATE');

            db.run(
                'UPDATE incidents SET triage_brief_json = ?, triage_status = ?, triage_generated_at = ?, updated_at = ? WHERE incident_id = ?',
                [JSON.stringify(brief), briefStatus, now, now, req.params.incident_id],
                function (updateErr) {
                    if (updateErr || this.changes === 0) {
                        return db.run('ROLLBACK', () => res.status(500).json({
                            success: false,
                            error: updateErr?.message || 'Failed to save triage brief'
                        }));
                    }

                    db.run(
                        "UPDATE incident_triage_jobs SET status = 'COMPLETED', completed_at = ?, locked_at = NULL, last_error = NULL, updated_at = ? WHERE incident_id = ?",
                        [now, now, req.params.incident_id],
                        (jobErr) => {
                            if (jobErr) {
                                return db.run('ROLLBACK', () => res.status(500).json({
                                    success: false,
                                    error: 'Brief saved but job update failed',
                                    details: jobErr.message
                                }));
                            }

                            db.run('COMMIT', (commitErr) => {
                                if (commitErr) {
                                    return res.status(500).json({
                                        success: false,
                                        error: 'Failed to commit triage brief'
                                    });
                                }

                                return res.json({
                                    success: true,
                                    incident_id: req.params.incident_id,
                                    triage_status: briefStatus,
                                    triage_generated_at: now,
                                    brief
                                });
                            });
                        }
                    );
                }
            );
        });
    } catch (error) {
        console.error('[WF05] Save triage brief error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to process triage brief'
        });
    }
});

// =====================================================
// END WF05 TRIAGE APIs
// =====================================================



// =====================================================
// WF05 ESCALATION APIs
// =====================================================

// 1. Get due escalations
router.get('/v1/escalations/due', requireApiKey, (req, res) => {
    const now = new Date().toISOString();
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

    db.all(
        "SELECT e.id AS escalation_id, e.incident_id, e.status, e.stage, e.due_at, e.reminder_count, " +
        "i.event_id, i.astronaut_id, i.severity, i.status AS incident_status " +
        "FROM incident_escalations e " +
        "JOIN incidents i ON i.incident_id = e.incident_id " +
        "WHERE e.status = 'ACTIVE' AND e.due_at <= ? " +
        "ORDER BY e.due_at ASC LIMIT ?",
        [now, limit],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            return res.json({ success: true, count: rows.length, escalations: rows });
        }
    );
});

// 2. Advance reminder/escalation stage
router.post('/v1/escalations/:id/advance', requireApiKey, (req, res) => {
    const escalationId = Number.parseInt(req.params.id, 10);
    const requestId = req.body?.request_id;

    if (!Number.isInteger(escalationId) || escalationId < 1 || !requestId) {
        return res.status(400).json({
            success: false,
            error: 'Valid escalation id and request_id are required'
        });
    }

    const now = new Date().toISOString();
    const escalationDelay = Math.max(
        1,
        Number.parseInt(process.env.WF05_ESCALATION_DELAY_MINUTES || "5", 10) || 5
    );

    db.serialize(() => {
        db.run('BEGIN IMMEDIATE', (beginErr) => {
            if (beginErr) return res.status(500).json({ success: false, error: beginErr.message });

            const rollback = (status, payload) =>
                db.run('ROLLBACK', () => res.status(status).json(payload));

            db.get(
                'SELECT * FROM incident_escalations WHERE id = ?',
                [escalationId],
                (err, row) => {
                    if (err) return rollback(500, { success: false, error: err.message });
                    if (!row) return rollback(404, { success: false, error: 'Escalation not found' });

                    if (row.last_request_id === String(requestId)) {
                        return db.run('COMMIT', () => res.json({
                            success: true,
                            idempotent: true,
                            escalation_id: row.id,
                            incident_id: row.incident_id,
                            status: row.status,
                            stage: row.stage
                        }));
                    }

                    if (row.status !== 'ACTIVE') {
                        return rollback(409, {
                            success: false,
                            error: 'Escalation is not active',
                            current_status: row.status
                        });
                    }

                    const nextStage = row.stage === 'REMINDER_1' ? 'ESCALATED' : null;
                    const nextStatus = nextStage ? 'ACTIVE' : 'COMPLETED';
                    const nextDueAt = nextStage
                        ? new Date(Date.now() + escalationDelay * 60000).toISOString()
                        : row.due_at;

                    db.run(
                        "UPDATE incident_escalations SET " +
                        "stage = COALESCE(?, stage), status = ?, due_at = ?, " +
                        "reminder_count = reminder_count + ?, last_request_id = ?, updated_at = ? " +
                        "WHERE id = ? AND status = 'ACTIVE'",
                        [
                            nextStage,
                            nextStatus,
                            nextDueAt,
                            row.stage === 'REMINDER_1' ? 1 : 0,
                            String(requestId),
                            now,
                            escalationId
                        ],
                        function (updateErr) {
                            if (updateErr) return rollback(500, { success: false, error: updateErr.message });
                            if (this.changes !== 1) return rollback(409, { success: false, error: 'Escalation changed; retry' });

                            db.run('COMMIT', (commitErr) => {
                                if (commitErr) return res.status(500).json({ success: false, error: commitErr.message });

                                return res.json({
                                    success: true,
                                    escalation_id: escalationId,
                                    incident_id: row.incident_id,
                                    previous_stage: row.stage,
                                    stage: nextStage || row.stage,
                                    status: nextStatus,
                                    due_at: nextDueAt,
                                    request_id: String(requestId)
                                });
                            });
                        }
                    );
                }
            );
        });
    });
});

// 3. Cancel active escalation
router.post('/v1/escalations/:id/cancel', requireApiKey, (req, res) => {
    const escalationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(escalationId) || escalationId < 1) {
        return res.status(400).json({ success: false, error: 'Invalid escalation id' });
    }

    const now = new Date().toISOString();

    db.run(
        "UPDATE incident_escalations SET status = 'CANCELLED', cancelled_at = ?, updated_at = ? " +
        "WHERE id = ? AND status = 'ACTIVE'",
        [now, now, escalationId],
        function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Active escalation not found'
                });
            }

            return res.json({
                success: true,
                escalation_id: escalationId,
                status: 'CANCELLED',
                cancelled_at: now
            });
        }
    );
});

// =====================================================
// END WF05 ESCALATION APIs
// =====================================================

module.exports = router;








