import React, { useState, useEffect } from 'react';
import Card from '../Common/Card';
import { vitalSeverity, getVitalSeverity, SEVERITY_COLORS } from '../../utils/vitalSeverity';

// Telemetry older than this (seconds) is flagged as stale.
const STALE_AFTER_SEC = 30;

const TONES = {
    ok: {
        border: 'rgba(34, 211, 238, 0.38)', borderHover: 'rgba(34, 211, 238, 0.92)',
        bg: 'rgba(6, 22, 42, 0.78)', bgHover: 'linear-gradient(155deg, rgba(8, 145, 178, 0.24), rgba(6, 22, 42, 0.94))',
        label: '#67e8f9', glow: ''
    },
    medium: {
        border: 'rgba(251, 191, 36, 0.85)', borderHover: '#fbbf24',
        bg: 'linear-gradient(155deg, rgba(251, 191, 36, 0.16), rgba(6, 22, 42, 0.9))', bgHover: 'linear-gradient(155deg, rgba(251, 191, 36, 0.26), rgba(6, 22, 42, 0.94))',
        label: '#fde68a', glow: 'rgba(251, 191, 36, 0.75)'
    },
    high: {
        border: 'rgba(248, 113, 113, 0.9)', borderHover: '#f87171',
        bg: 'linear-gradient(155deg, rgba(239, 68, 68, 0.2), rgba(6, 22, 42, 0.9))', bgHover: 'linear-gradient(155deg, rgba(239, 68, 68, 0.3), rgba(6, 22, 42, 0.94))',
        label: '#fca5a5', glow: 'rgba(248, 113, 113, 0.8)'
    }
};

const SEVERITY_TEXT = { ok: 'Signal normal', medium: 'Warning: outside normal range', high: 'Alert: abnormal reading' };

const TELEMETRY_META = {
    heart_rate: {
        code: 'CH-01 // ECG',
        label: 'Heart Rate',
        unit: 'BPM',
        min: 45,
        max: 120,
        isHeart: true
    },
    spo2: {
        code: 'CH-02 // O2',
        label: 'Blood Oxygen',
        unit: '%',
        min: 88,
        max: 100,
        isHeart: false
    },
    temperature: {
        code: 'CH-03 // THRM',
        label: 'Skin Temp',
        unit: '°C',
        min: 35.0,
        max: 38.5,
        isHeart: false
    },
    hrv: {
        code: 'CH-04 // HRV',
        label: 'HRV Index',
        unit: 'ms',
        min: 15,
        max: 130,
        isHeart: false
    },
    respiratory_rate: {
        code: 'CH-05 // RESP',
        label: 'Resp. Rate',
        unit: 'br/min',
        min: 8,
        max: 26,
        isHeart: false
    }
};

// Normal resting heart-rate range shown on the heart-rate gauge (BPM).
const HR_NORMAL = { min: 60, max: 100 };
// Visible span of the gauge (BPM).
const HR_SCALE = { min: 40, max: 140 };

const hrPosition = (v) => {
    const pct = ((v - HR_SCALE.min) / (HR_SCALE.max - HR_SCALE.min)) * 100;
    return Math.max(0, Math.min(100, pct));
};

const getHeartStatus = (val) => {
    const n = Number(val);
    if (val === null || val === undefined || !Number.isFinite(n)) {
        return { label: 'NO SIGNAL', color: '#94a3b8' };
    }
    const color = SEVERITY_COLORS[getVitalSeverity('heart_rate', n)];
    if (n < HR_NORMAL.min) return { label: 'BELOW RANGE', color };
    if (n > HR_NORMAL.max) return { label: 'ABOVE RANGE', color };
    return { label: 'NORMAL', color: '#4ade80' };
};

const HeartRangeGauge = ({ value }) => {
    const n = Number(value);
    const hasValue = value !== null && value !== undefined && Number.isFinite(n);
    const status = getHeartStatus(value);
    const lowEnd = hrPosition(HR_NORMAL.min);
    const highStart = hrPosition(HR_NORMAL.max);

    return (
        <div style={{ marginTop: 11 }}>
            <div style={{ position: 'relative', height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${lowEnd}%`, background: 'rgba(251, 191, 36, 0.75)' }} />
                <div style={{ width: `${highStart - lowEnd}%`, background: 'rgba(34, 197, 94, 0.85)' }} />
                <div style={{ width: `${100 - highStart}%`, background: 'rgba(239, 68, 68, 0.8)' }} />
            </div>
            {hasValue && (
                <div
                    style={{
                        position: 'relative',
                        height: 0
                    }}
                >
                    <span
                        style={{
                            position: 'absolute',
                            left: `${hrPosition(n)}%`,
                            top: -10,
                            width: 12,
                            height: 12,
                            marginLeft: -6,
                            borderRadius: '50%',
                            background: '#f0f9ff',
                            border: `2px solid ${status.color}`,
                            boxShadow: `0 0 8px ${status.color}`,
                            boxSizing: 'border-box',
                            transition: 'left 0.35s ease'
                        }}
                    />
                </div>
            )}
            <div
                style={{
                    position: 'relative',
                    height: 12,
                    marginTop: 7,
                    fontFamily: 'monospace',
                    fontSize: '0.58rem',
                    color: '#a9bdd3'
                }}
            >
                <span style={{ position: 'absolute', left: `${lowEnd}%`, transform: 'translateX(-50%)' }}>{HR_NORMAL.min}</span>
                <span style={{ position: 'absolute', left: `${highStart}%`, transform: 'translateX(-50%)' }}>{HR_NORMAL.max}</span>
            </div>
            <div
                style={{
                    marginTop: 4,
                    fontFamily: 'monospace',
                    fontSize: '0.62rem',
                    letterSpacing: '0.06em',
                    fontWeight: 700,
                    color: status.color,
                    whiteSpace: 'nowrap'
                }}
            >
                {status.label}{status.label === 'NORMAL' ? ` ${HR_NORMAL.min}\u2013${HR_NORMAL.max}` : ''}
            </div>
        </div>
    );
};

const getProgress = (val, min, max) => {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return 0;
    const ratio = ((Number(val) - min) / (max - min)) * 100;
    return Math.max(8, Math.min(100, ratio));
};

const HologramCore = ({ isHeartActive }) => (
    <div
        title="Holographic Telemetry Emitter"
        style={{
            position: 'relative',
            width: 38,
            height: 38,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(34, 211, 238, 0.16) 0%, rgba(6, 20, 38, 0.2) 70%)',
            boxShadow: isHeartActive
                ? '0 0 14px rgba(34, 211, 238, 0.25), 0 0 10px rgba(239, 68, 68, 0.2)'
                : '0 0 14px rgba(34, 211, 238, 0.25)',
            flexShrink: 0
        }}
    >
        <div
            style={{
                position: 'absolute',
                inset: 2,
                borderRadius: '50%',
                border: '1px dashed rgba(34, 211, 238, 0.75)'
            }}
        />
        <div
            style={{
                position: 'absolute',
                inset: 8,
                borderRadius: '50%',
                border: '1px solid rgba(103, 232, 249, 0.45)',
                transform: 'rotateX(55deg)'
            }}
        />
        <div
            style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isHeartActive ? '#ef4444' : '#22d3ee',
                boxShadow: isHeartActive
                    ? '0 0 10px rgba(239, 68, 68, 0.9)'
                    : '0 0 10px rgba(34, 211, 238, 0.9)'
            }}
        />
    </div>
);

const VitalsWidget = ({ vitals, onClick, alertLevel = null, flaggedKeys = [] }) => {
    const [activeKey, setActiveKey] = useState(null);
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    if (!vitals) {
        return <Card title="ORBITAL TELEMETRY // LIVE VITALS">Syncing sensor stream...</Card>;
    }

    const lastMs = vitals.timestamp ? new Date(vitals.timestamp).getTime() : NaN;
    const ageSec = Number.isFinite(lastMs) ? Math.max(0, Math.round((nowMs - lastMs) / 1000)) : null;
    const isStale = ageSec !== null && ageSec > STALE_AFTER_SEC;
    const ageLabel = ageSec === null ? '' : ageSec < 60 ? `${ageSec}s ago`
        : ageSec < 3600 ? `${Math.floor(ageSec / 60)} min ago`
        : ageSec < 86400 ? `${Math.floor(ageSec / 3600)} h ago`
        : `${Math.floor(ageSec / 86400)} d ago`;

    const items = [
        { key: 'heart_rate', value: vitals.heart_rate },
        { key: 'spo2', value: vitals.spo2 },
        { key: 'temperature', value: vitals.temperature },
        { key: 'hrv', value: vitals.hrv },
        { key: 'respiratory_rate', value: vitals.respiratory_rate }
    ];

    return (
        <Card
            title={isStale ? 'ORBITAL TELEMETRY // LAST KNOWN VITALS' : 'ORBITAL TELEMETRY // LIVE VITALS'}
            className={onClick ? 'clickable-card' : ''}
            style={{
                ...(onClick ? { cursor: 'pointer' } : {}),
                background: 'linear-gradient(165deg, rgba(6, 20, 38, 0.95), rgba(4, 12, 24, 0.98))',
                border: '1px solid rgba(34, 211, 238, 0.38)',
                boxShadow: '0 0 24px rgba(34, 211, 238, 0.09)'
            }}
            onClick={onClick}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 14,
                    paddingBottom: 10,
                    borderBottom: '1px solid rgba(34, 211, 238, 0.16)'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <HologramCore isHeartActive={alertLevel === 'high'} />
                    <div>
                        <div
                            style={{
                                fontFamily: 'monospace',
                                fontSize: '0.68rem',
                                letterSpacing: '0.1em',
                                color: isStale ? '#fbbf24' : '#67e8f9'
                            }}
                        >
                            {isStale ? 'HOLO-LINK // DATA STALE' : 'HOLO-LINK // ACTIVE'}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                            Biometric telemetry stream
                        </div>
                    </div>
                </div>
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 14,
                    perspective: '1000px'
                }}
            >
                {items.map(({ key, value }) => {
                    const meta = TELEMETRY_META[key];
                    const isHovered = activeKey === key;
                    const progress = getProgress(value, meta.min, meta.max);
                    const severity = vitalSeverity(key, value, alertLevel, flaggedKeys);
                    const tone = TONES[severity];
                    const dotColor = SEVERITY_COLORS[severity];

                    return (
                        <div
                            key={key}
                            className={severity === 'ok' ? '' : `vital-glow vital-glow-${severity}`}
                            onMouseEnter={() => setActiveKey(key)}
                            onMouseLeave={() => setActiveKey(null)}
                            style={{
                                '--glow': tone.glow,
                                position: 'relative',
                                padding: '13px 14px',
                                borderRadius: 10,
                                background: isHovered ? tone.bgHover : tone.bg,
                                border: `1px solid ${isHovered ? tone.borderHover : tone.border}`,
                                boxShadow: isHovered
                                    ? '0 12px 24px rgba(0, 0, 0, 0.4), 0 0 16px rgba(34, 211, 238, 0.25)'
                                    : '0 0 12px rgba(34, 211, 238, 0.08)',
                                transform: isHovered
                                    ? 'translateY(-4px) rotateX(5deg) rotateY(-4deg) translateZ(8px)'
                                    : 'translateY(0) rotateX(0deg) rotateY(0deg) translateZ(0px)',
                                transformStyle: 'preserve-3d',
                                transition: 'transform 0.24s ease, box-shadow 0.24s ease, border-color 0.24s ease, background 0.24s ease'
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    fontFamily: 'monospace',
                                    fontSize: '0.64rem',
                                    letterSpacing: '0.08em',
                                    color: tone.label,
                                    marginBottom: 5
                                }}
                            >
                                <span>{meta.code}</span>
                                <span
                                    title={SEVERITY_TEXT[severity]}
                                    style={{
                                        width: 7,
                                        height: 7,
                                        borderRadius: '50%',
                                        backgroundColor: dotColor,
                                        boxShadow: `0 0 8px ${dotColor}`
                                    }}
                                />
                            </div>

                            <div
                                style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    color: '#cbd5e1',
                                    marginBottom: 8
                                }}
                            >
                                {meta.label}
                            </div>

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: 5,
                                    color: '#f0f9ff',
                                    fontSize: '1.6rem',
                                    fontWeight: 700,
                                    lineHeight: 1.15
                                }}
                            >
                                <span>{value ?? '\u2014'}</span>
                                <span
                                    style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 500,
                                        color: '#a9bdd3'
                                    }}
                                >
                                    {meta.unit}
                                </span>
                            </div>

                            {meta.isHeart ? (
                                <HeartRangeGauge value={value} />
                            ) : (
                                <div
                                    style={{
                                        marginTop: 11,
                                        height: 4,
                                        borderRadius: 999,
                                        background: 'rgba(34, 211, 238, 0.14)',
                                        overflow: 'hidden'
                                    }}
                                >
                                    <div
                                        style={{
                                            height: '100%',
                                            width: `${progress}%`,
                                            borderRadius: 999,
                                            background: severity === 'ok'
                                                ? 'linear-gradient(90deg, #06b6d4, #22d3ee)'
                                                : `linear-gradient(90deg, ${dotColor}, ${dotColor})`,
                                            transition: 'width 0.35s ease'
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {vitals.timestamp && (
                <div
                    style={{
                        marginTop: 14,
                        paddingTop: 10,
                        borderTop: '1px solid rgba(34, 211, 238, 0.18)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 8,
                        fontFamily: 'monospace',
                        fontSize: '0.74rem',
                        color: '#67e8f9'
                    }}
                >
                    <span>DOWNLINK // CAIRO-EET</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#a9bdd3' }}>
                        {isStale && (
                            <span
                                style={{
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    border: '1px solid rgba(251, 191, 36, 0.7)',
                                    background: 'rgba(251, 191, 36, 0.16)',
                                    color: '#fde68a',
                                    fontWeight: 700,
                                    letterSpacing: '0.06em'
                                }}
                            >
                                DATA STALE
                            </span>
                        )}
                        <span>
                            Last updated:{' '}
                            {new Intl.DateTimeFormat('en-GB', {
                                timeZone: 'Africa/Cairo',
                                dateStyle: 'medium',
                                timeStyle: 'medium'
                            }).format(new Date(vitals.timestamp))}
                            {ageLabel && ` (${ageLabel})`}
                        </span>
                    </span>
                </div>
            )}
        </Card>
    );
};

export default VitalsWidget;
