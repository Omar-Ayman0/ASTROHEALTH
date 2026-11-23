// Severity of a single vital reading, shared by the vitals cards and the hologram.
// A card/callout turns red ('high') ONLY when its own value is outside the normal range
// (too low OR too high). Inside the range it stays 'ok'. Edit the numbers here to tune the thresholds.
// 'medium' is kept in the table only for backwards compatibility and is no longer produced.
export const SEVERITY_RANK = { ok: 0, medium: 1, high: 2 };

export const VITAL_RANGES = {
    heart_rate: { normal: [50, 100], warn: [40, 120] },
    spo2: { normal: [95, 101], warn: [90, 101] },
    temperature: { normal: [35.5, 37.5], warn: [34.5, 38.5] },
    hrv: { normal: [20, 120], warn: [10, 150] },
    respiratory_rate: { normal: [12, 20], warn: [10, 24] }
};

export const SEVERITY_COLORS = {
    ok: '#4ade80',
    medium: '#fbbf24',
    high: '#f87171'
};

export const getVitalSeverity = (key, value) => {
    const range = VITAL_RANGES[key];
    const n = Number(value);
    if (!range || value === null || value === undefined || !Number.isFinite(n)) return 'ok';
    return n >= range.normal[0] && n <= range.normal[1] ? 'ok' : 'high';
};

export const maxSeverity = (a, b) => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

// Alert level of the whole dashboard -> 'high' | 'medium' | null
export const alertLevelFrom = (isCritical, isHighRisk) =>
    isCritical ? 'high' : isHighRisk ? 'medium' : null;

// Engine "top factors" (e.g. "heart rate bpm", "spo2_pct") -> vital keys
export const flaggedKeysFromFeatures = (features = []) => {
    const keys = new Set();
    (features || []).forEach((f) => {
        const t = String(f).toLowerCase().replace(/_/g, ' ');
        if (t.includes('heart')) keys.add('heart_rate');
        else if (t.includes('spo2') || t.includes('oxygen')) keys.add('spo2');
        else if (t.includes('temp')) keys.add('temperature');
        else if (t.includes('hrv')) keys.add('hrv');
        else if (t.includes('resp')) keys.add('respiratory_rate');
    });
    return [...keys];
};

// Final severity of one vital: decided by its own value only.
// alertLevel / flaggedKeys are still accepted so existing callers keep working, but they are ignored:
// the engine's overall anomaly flag no longer turns a normal reading red.
export const vitalSeverity = (key, value /* , alertLevel, flaggedKeys */) => getVitalSeverity(key, value);

// Overall level of a vitals object -> 'high' if at least one vital is outside its normal range, else null.
export const levelFromVitals = (vitals = {}) =>
    ['heart_rate', 'spo2', 'temperature', 'hrv', 'respiratory_rate']
        .some((k) => getVitalSeverity(k, vitals?.[k]) === 'high')
        ? 'high'
        : null;
