/*
 * Doctor Dashboard notification model.
 *
 * Pure functions only (no React, no network) so the mapping can be unit-tested.
 * Everything here is derived from the two EXISTING backend responses:
 *
 *   GET /api/doctor/incidents
 *       -> { incidents: [{ incident_id, event_id, astronaut_id, status, engine_status,
 *                          severity, created_at, updated_at, assigned_role, source }] }
 *
 *   GET /api/doctor/incidents/:id/wf05-status
 *       -> { incident: { incident_id, astronaut_id, severity, status, triage_status, ... },
 *            triage:     { status, generated_at, brief },
 *            escalation: { status, stage, reminder_count } }
 *
 * Escalation lifecycle as implemented by the backend (read-only reference):
 *   ACTIVE    / REMINDER_1  reminder_count 0   (created with the incident)
 *   ACTIVE    / ESCALATED   reminder_count 1   (after the first WF05 advance)
 *   COMPLETED / ESCALATED   reminder_count 1   (after the second advance: the timers ran out)
 *   CANCELLED               (the doctor ACKNOWLEDGED while the escalation was ACTIVE)
 *
 * The API does NOT expose an escalation timestamp (due_at / updated_at). The only
 * time we can show is the incident's own updated_at/created_at, plus the moment this
 * browser first saw a given escalation state ("detectedAt").
 */

export const CATEGORY = {
    CRITICAL_ESCALATION: 'CRITICAL_ESCALATION',
    MEDICAL_REVIEW: 'MEDICAL_REVIEW',
    ESCALATION_REMINDER: 'ESCALATION_REMINDER',
    TRIAGE_COMPLETED: 'TRIAGE_COMPLETED',
    TRIAGE_FAILED: 'TRIAGE_FAILED',
    GENERAL: 'GENERAL'
};

export const CATEGORY_LABEL = {
    CRITICAL_ESCALATION: 'Critical Escalation',
    MEDICAL_REVIEW: 'Medical Review Required',
    ESCALATION_REMINDER: 'Escalation Reminder',
    TRIAGE_COMPLETED: 'AI Triage Completed',
    TRIAGE_FAILED: 'AI Triage Failed',
    GENERAL: 'General Update'
};

export const PRIORITY_RANK = { critical: 0, high: 1, normal: 2 };

export const READ_STORAGE_KEY = 'astrohealth_wf05_read';
export const SEEN_STORAGE_KEY = 'astrohealth_wf05_seen';
const MAX_STORED_KEYS = 400;

const up = (value) => String(value ?? '').trim().toUpperCase();

const toTime = (value) => {
    const t = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(t) ? t : 0;
};

export const humanize = (value) =>
    String(value ?? '')
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

/**
 * Build the notifications for ONE incident.
 *
 * @param row  an item of GET /api/doctor/incidents
 * @param wf   the body of GET /api/doctor/incidents/:id/wf05-status (or null if unavailable)
 *
 * An escalation is an UPDATE to an existing incident, so each incident yields at most one
 * escalation notification and, when it does, the generic "review required" notification
 * for the same incident is suppressed (the escalation card already shows the review status).
 */
export function buildIncidentNotifications(row, wf) {
    if (!row || !row.incident_id) return [];

    const inc = wf?.incident || {};
    const triage = wf?.triage || {};
    const esc = wf?.escalation || {};

    const incidentId = row.incident_id;
    const astronautId = row.astronaut_id || inc.astronaut_id || 'Unknown';
    // wf05-status is fetched after the list call, so its values are the freshest.
    const severity = up(inc.severity || row.severity) || 'UNKNOWN';
    const reviewStatus = up(inc.status || row.status) || 'UNKNOWN';
    const timestamp = row.updated_at || row.created_at || null;

    const escStatus = up(esc.status);
    const escStage = up(esc.stage);
    const reminderCount = Number.isFinite(Number(esc.reminder_count)) ? Number(esc.reminder_count) : 0;
    const triageStatus = up(triage.status) || 'NOT_CREATED';

    const base = {
        incidentId,
        astronautId,
        severity,
        reviewStatus,
        triageStatus,
        escalationStatus: escStatus || null,
        escalationStage: escStage || null,
        reminderCount: escStatus ? reminderCount : null
    };

    const out = [];
    const push = (type, version, category, priority, title, summary, extra = {}) => {
        out.push({
            ...base,
            key: `${incidentId}|${type}|${version}`,
            category,
            priority,
            title,
            summary,
            timestamp,
            timestampLabel: 'Incident updated',
            ...extra
        });
    };

    /* ---------- escalation (any status that matters, not only PENDING_MEDICAL_REVIEW) ---------- */
    const escalationActive = escStatus === 'ACTIVE';
    // The WF05 timers ran out (COMPLETED) while the doctor never acknowledged.
    const escalationExhausted = escStatus === 'COMPLETED' && reviewStatus === 'PENDING_MEDICAL_REVIEW';
    let hasEscalation = false;

    if (escalationActive || escalationExhausted) {
        hasEscalation = true;
        const escKeyVersion = `${escStatus}:${escStage || '-'}:${reminderCount}`;

        if (escalationExhausted || escStage === 'ESCALATED') {
            push(
                'escalation', escKeyVersion,
                CATEGORY.CRITICAL_ESCALATION, 'critical',
                escalationExhausted ? 'Escalation window elapsed' : 'Incident escalated',
                escalationExhausted
                    ? 'All WF05 reminders were sent and the incident is still unacknowledged.'
                    : 'Reminder was not acknowledged; the incident is now escalated.',
                { isEscalation: true }
            );
        } else {
            push(
                'escalation', escKeyVersion,
                CATEGORY.ESCALATION_REMINDER, 'high',
                'Escalation reminder',
                'Active escalation on an existing incident. Acknowledge to stop further reminders.',
                { isEscalation: true }
            );
        }
    }

    /* ---------- medical review ---------- */
    if (!hasEscalation) {
        if (reviewStatus === 'PENDING_MEDICAL_REVIEW') {
            push('review', reviewStatus, CATEGORY.MEDICAL_REVIEW, 'high',
                'Medical review required', 'Incident is waiting for acknowledgement.');
        } else if (reviewStatus === 'ACKNOWLEDGED' || reviewStatus === 'IN_REVIEW') {
            push('review', reviewStatus, CATEGORY.MEDICAL_REVIEW, 'normal',
                reviewStatus === 'IN_REVIEW' ? 'Medical review in progress' : 'Incident acknowledged',
                reviewStatus === 'IN_REVIEW'
                    ? 'Review has started; complete the review when done.'
                    : 'Start the review when ready.');
        }
    }

    /* ---------- AI triage (history of finished reviews is not repeated) ---------- */
    if (reviewStatus !== 'REVIEW_COMPLETED') {
        const triageTime = triage.generated_at || null;
        if (triageStatus === 'FAILED') {
            push('triage', 'FAILED', CATEGORY.TRIAGE_FAILED, 'high',
                'AI triage failed', 'Automatic triage could not be generated. Review the incident manually.');
        } else if (triageStatus === 'COMPLETED' || triageStatus === 'FALLBACK') {
            push('triage', `${triageStatus}:${triageTime || ''}`, CATEGORY.TRIAGE_COMPLETED, 'normal',
                triageStatus === 'FALLBACK' ? 'AI triage completed (fallback)' : 'AI triage completed',
                'A triage brief is available for human review.',
                { timestamp: triageTime || timestamp, timestampLabel: triageTime ? 'Triage generated' : 'Incident updated' });
        } else if (triageStatus !== 'NOT_CREATED') {
            push('triage', triageStatus, CATEGORY.GENERAL, 'normal',
                `AI triage ${humanize(triageStatus).toLowerCase()}`, 'Triage is being prepared.');
        }
    }

    return out;
}

export const compareNotifications = (a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    const t = toTime(b.timestamp) - toTime(a.timestamp);
    if (t !== 0) return t;
    return String(a.key).localeCompare(String(b.key));
};

/** Merge per-incident lists, drop duplicate keys, sort by priority then recency. */
export function mergeNotifications(lists) {
    const byKey = new Map();
    lists.flat().forEach((n) => { if (!byKey.has(n.key)) byKey.set(n.key, n); });
    return [...byKey.values()].sort(compareNotifications);
}

/* ------------------------------ persistence (localStorage) ------------------------------ */

const readJson = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
};

const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

export const loadReadKeys = () => {
    const stored = readJson(READ_STORAGE_KEY, []);
    return Array.isArray(stored) ? stored.filter((k) => typeof k === 'string') : [];
};

export const saveReadKeys = (keys) => writeJson(READ_STORAGE_KEY, keys.slice(-MAX_STORED_KEYS));

export const loadSeenMap = () => {
    const stored = readJson(SEEN_STORAGE_KEY, {});
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
};

export const saveSeenMap = (map) => {
    const entries = Object.entries(map);
    const trimmed = entries.length > MAX_STORED_KEYS
        ? Object.fromEntries(entries.sort((a, b) => toTime(a[1]) - toTime(b[1])).slice(-MAX_STORED_KEYS))
        : map;
    writeJson(SEEN_STORAGE_KEY, trimmed);
};

/* ------------------------------ formatting ------------------------------ */

export const formatTimestamp = (value) => {
    const t = toTime(value);
    return t ? new Date(t).toLocaleString() : '';
};

export const formatRelative = (value, now = Date.now()) => {
    const t = toTime(value);
    if (!t) return '';
    const diff = Math.max(0, now - t);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} h ago`;
    return `${Math.floor(hr / 24)} d ago`;
};
