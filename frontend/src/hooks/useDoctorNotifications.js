import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import {
    CATEGORY,
    READ_STORAGE_KEY,
    buildIncidentNotifications,
    loadReadKeys,
    loadSeenMap,
    mergeNotifications,
    saveReadKeys,
    saveSeenMap
} from '../utils/doctorNotifications';

const POLL_MS = 25000;       // 20-30 s window requested for the doctor
const LIST_TIMEOUT_MS = 12000;
const STATUS_TIMEOUT_MS = 10000;
const CONCURRENCY = 6;       // wf05-status calls in flight at once

const isTerminal = (status) => String(status || '').toUpperCase() === 'REVIEW_COMPLETED';

/**
 * Polls the EXISTING doctor endpoints and turns them into notifications.
 *
 *  - No `.slice(0, 10)`: every incident is checked, so an old incident that still has an
 *    active escalation is never hidden.
 *  - Finished reviews (REVIEW_COMPLETED) are re-checked only when their updated_at changes,
 *    so the request count stays bounded as history grows.
 *  - Requests never overlap (in-flight guard + chained timeout instead of setInterval).
 *  - If a refresh fails, the last good notifications stay on screen.
 *  - Read state is stored by stable keys; opening the dropdown never marks anything as read.
 */
export function useDoctorNotifications() {
    const [data, setData] = useState({
        notifications: [],
        statusById: {},
        loading: true,
        error: null,
        partialFailures: 0,
        lastUpdated: null
    });
    const [readKeys, setReadKeys] = useState(loadReadKeys);
    const [alertTick, setAlertTick] = useState(0);

    const inFlight = useRef(false);
    const cache = useRef(new Map());          // incident_id -> { wf, updatedAt }
    const previousKeys = useRef(null);        // Set of keys from the previous successful load
    const readRef = useRef(new Set(readKeys));
    const timerRef = useRef(null);
    const aliveRef = useRef(true);

    useEffect(() => { readRef.current = new Set(readKeys); }, [readKeys]);

    const load = useCallback(async () => {
        if (inFlight.current || !aliveRef.current) return;
        inFlight.current = true;

        try {
            const listRes = await axios.get(`${API_URL}/api/doctor/incidents`, { timeout: LIST_TIMEOUT_MS });
            const rows = Array.isArray(listRes.data?.incidents) ? listRes.data.incidents : [];

            // Which incidents need a fresh wf05-status call?
            const targets = rows.filter((row) => {
                const cached = cache.current.get(row.incident_id);
                return !(cached && isTerminal(row.status) && cached.updatedAt === row.updated_at);
            });

            let failures = 0;
            let cursor = 0;
            const worker = async () => {
                while (cursor < targets.length) {
                    const row = targets[cursor++];
                    try {
                        const res = await axios.get(
                            `${API_URL}/api/doctor/incidents/${encodeURIComponent(row.incident_id)}/wf05-status`,
                            { timeout: STATUS_TIMEOUT_MS }
                        );
                        cache.current.set(row.incident_id, { wf: res.data, updatedAt: row.updated_at });
                    } catch {
                        // keep whatever we knew about this incident last time
                        failures += 1;
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

            if (!aliveRef.current) return;

            const lists = [];
            const statusById = {};
            rows.forEach((row) => {
                const wf = cache.current.get(row.incident_id)?.wf || null;
                if (wf) statusById[row.incident_id] = { triage: wf.triage || {}, escalation: wf.escalation || {} };
                lists.push(buildIncidentNotifications(row, wf));
            });
            const notifications = mergeNotifications(lists);

            // First time this browser sees a state -> remember when (the API has no escalation timestamp).
            const seen = loadSeenMap();
            const nowIso = new Date().toISOString();
            let seenChanged = false;
            notifications.forEach((n) => {
                if (!seen[n.key]) { seen[n.key] = nowIso; seenChanged = true; }
                n.detectedAt = seen[n.key];
            });
            if (seenChanged) saveSeenMap(seen);

            // Subtle "new alert" animation only for new, unread, high-attention escalations.
            const prev = previousKeys.current;
            const arrived = prev && notifications.some((n) =>
                !prev.has(n.key) &&
                !readRef.current.has(n.key) &&
                (n.category === CATEGORY.CRITICAL_ESCALATION || n.category === CATEGORY.ESCALATION_REMINDER)
            );
            previousKeys.current = new Set(notifications.map((n) => n.key));
            if (arrived) setAlertTick((t) => t + 1);

            setData({
                notifications,
                statusById,
                loading: false,
                error: null,
                partialFailures: failures,
                lastUpdated: nowIso
            });
        } catch (err) {
            if (!aliveRef.current) return;
            console.error('Doctor notifications unavailable:', err);
            // keep the last successful notifications visible
            setData((d) => ({
                ...d,
                loading: false,
                error: (err?.response?.status ? `HTTP ${err.response.status}: ` : '') +
                    (err?.response?.data?.error || err?.message || 'Notifications could not be refreshed.')
            }));
        } finally {
            inFlight.current = false;
        }
    }, []);

    useEffect(() => {
        aliveRef.current = true;

        const tick = async () => {
            if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
                await load();
            }
            if (aliveRef.current) timerRef.current = setTimeout(tick, POLL_MS);
        };
        tick();

        const onVisible = () => {
            if (document.visibilityState === 'visible') load();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            aliveRef.current = false;
            clearTimeout(timerRef.current);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [load]);

    // Keep several tabs in sync.
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === READ_STORAGE_KEY) setReadKeys(loadReadKeys());
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const markRead = useCallback((key) => {
        setReadKeys((prev) => {
            if (prev.includes(key)) return prev;
            const next = [...prev, key];
            saveReadKeys(next);
            return next;
        });
    }, []);

    const markAllRead = useCallback(() => {
        setReadKeys((prev) => {
            const merged = new Set(prev);
            data.notifications.forEach((n) => merged.add(n.key));
            const next = [...merged];
            saveReadKeys(next);
            return next;
        });
    }, [data.notifications]);

    const notifications = useMemo(() => {
        const read = new Set(readKeys);
        return data.notifications.map((n) => ({ ...n, read: read.has(n.key) }));
    }, [data.notifications, readKeys]);

    const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
    const unreadCritical = useMemo(
        () => notifications.filter((n) => !n.read && n.priority === 'critical').length,
        [notifications]
    );

    return {
        notifications,
        unreadCount,
        unreadCritical,
        statusById: data.statusById,
        loading: data.loading,
        error: data.error,
        partialFailures: data.partialFailures,
        lastUpdated: data.lastUpdated,
        alertTick,
        markRead,
        markAllRead,
        refresh: load
    };
}

export default useDoctorNotifications;
