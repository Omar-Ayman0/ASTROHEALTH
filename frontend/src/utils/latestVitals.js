// The engine sometimes sends a tick with one sensor missing (null). Instead of flashing an empty card,
// use the most recent tick that has a valid value for each vital, and report which ones are "held".
const isValid = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export const latestValidVitals = (ticks) => {
    const fields = {
        heart_rate: 'heart_rate_bpm',
        spo2: 'spo2_pct',
        temperature: 'skin_temp_c',
        hrv: 'hrv_ms',
        respiratory_rate: 'resp_rate_bpm'
    };
    const last = ticks.length - 1;
    const out = { held_keys: [] };

    Object.entries(fields).forEach(([key, field]) => {
        out[key] = null;
        for (let i = last; i >= 0; i--) {
            const v = ticks[i]?.vitals?.[field];
            if (isValid(v)) {
                out[key] = v;
                if (i !== last) out.held_keys.push(key);
                break;
            }
        }
    });

    return out;
};
