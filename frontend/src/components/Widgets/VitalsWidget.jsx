import React, { useState } from 'react';
import Card from '../Common/Card';

const RANGES = {
    heart_rate: { min: 50, max: 110, normalMin: 60, normalMax: 100, tag: 'ECG // HR' },
    spo2: { min: 90, max: 100, normalMin: 95, normalMax: 100, tag: 'O2 SAT' },
    temperature: { min: 35.5, max: 38.0, normalMin: 36.1, normalMax: 37.2, tag: 'THRM // SKN' },
    hrv: { min: 20, max: 120, normalMin: 40, normalMax: 100, tag: 'R-R // HRV' },
    respiratory_rate: { min: 8, max: 24, normalMin: 12, normalMax: 20, tag: 'RESP // BIO' }
};

const getBarPercent = (value, min, max) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
    const pct = ((Number(value) - min) / (max - min)) * 100;
    return Math.max(6, Math.min(100, pct));
};

const isOutOfNominal = (key, value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return false;
    const r = RANGES[key];
    if (!r) return false;
    return Number(value) < r.normalMin || Number(value) > r.normalMax;
};

const VitalsWidget = ({ vitals, onClick }) => {
    const [hoveredKey, setHoveredKey] = useState(null);

    if (!vitals) {
        return <Card title="LIVE TELEMETRY // VITALS">Acquiring telemetry stream...</Card>;
    }

    const metrics = [
        { key: 'heart_rate', label: 'Heart Rate', value: vitals.heart_rate, unit: 'BPM', isHeart: true },
        { key: 'spo2', label: 'Blood Oxygen', value: vitals.spo2, unit: '%', isHeart: false },
        { key: 'temperature', label: 'Skin Temp', value: vitals.temperature, unit: '°C', isHeart: false },
        { key: 'hrv', label: 'HRV', value: vitals.hrv, unit: 'ms', isHeart: false },
        { key: 'respiratory_rate', label: 'Resp. Rate', value: vitals.respiratory_rate, unit: 'BPM', isHeart: false }
    ];

    return (
        <Card
            title="LIVE TELEMETRY // VITALS"
            className={onClick ? 'clickable-card' : ''}
            style={onClick ? { cursor: 'pointer' } : {}}
            onClick={onClick}
        >
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
                    gap: 14,
                    perspective: '900px'
                }}
            >
                {metrics.map((item) => {
                    const range = RANGES[item.key];
                    const isHovered = hoveredKey === item.key;
                    const abnormal = isOutOfNominal(item.key, item.value);
                    const pct = getBarPercent(item.value, range.min, range.max);

                    const accentColor = item.isHeart
                        ? '#ef4444'
                        : abnormal
                            ? '#f87171'
                            : '#38bdf8';

                    return (
                        <div
                            key={item.key}
                            onMouseEnter={() => setHoveredKey(item.key)}
                            onMouseLeave={() => setHoveredKey(null)}
                            style={{
                                position: 'relative',
                                padding: '12px 14px',
                                borderRadius: 10,
                                border: `1px solid ${
                                    isHovered
                                        ? item.isHeart
                                            ? 'rgba(239, 68, 68, 0.45)'
                                            : 'rgba(56, 189, 248, 0.4)'
                                        : 'rgba(125, 181, 220, 0.14)'
                                }`,
                                borderTop: `2px solid ${accentColor}`,
                                background: isHovered
                                    ? 'linear-gradient(160deg, rgba(15, 34, 58, 0.92), rgba(8, 20, 36, 0.92))'
                                    : 'rgba(9, 22, 40, 0.55)',
                                boxShadow: isHovered
                                    ? '0 10px 22px rgba(0, 0, 0, 0.28)'
                                    : 'none',
                                transform: isHovered
                                    ? 'translateY(-3px) rotateX(3.5deg) rotateY(-3deg)'
                                    : 'translateY(0) rotateX(0deg) rotateY(0deg)',
                                transformStyle: 'preserve-3d',
                                transition: 'all 0.22s ease'
                            }}
                        >
                            {/* Telemetry channel tag & status dot */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    fontSize: '0.65rem',
                                    fontFamily: 'monospace',
                                    letterSpacing: '0.08em',
                                    color: item.isHeart ? '#fca5a5' : 'var(--text-secondary, #91a9c2)',
                                    marginBottom: 4
                                }}
                            >
                                <span>{range.tag}</span>
                                <span
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        backgroundColor: abnormal ? '#ef4444' : item.isHeart ? '#ef4444' : '#38bdf8',
                                        opacity: item.isHeart || abnormal ? 0.95 : 0.65
                                    }}
                                />
                            </div>

                            {/* Readable metric title */}
                            <div
                                style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary, #91a9c2)',
                                    marginBottom: 6
                                }}
                            >
                                {item.label}
                            </div>

                            {/* Clean numeric readout without heavy glow/box */}
                            <div
                                style={{
                                    fontSize: '1.55rem',
                                    fontWeight: 700,
                                    lineHeight: 1.15,
                                    color: 'var(--text-primary, #e8f4ff)',
                                    background: 'transparent',
                                    boxShadow: 'none',
                                    padding: 0,
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: 5
                                }}
                            >
                                <span>{item.value ?? '—'}</span>
                                <span
                                    style={{
                                        fontSize: '0.76rem',
                                        fontWeight: 500,
                                        color: 'var(--text-secondary, #91a9c2)'
                                    }}
                                >
                                    {item.unit}
                                </span>
                            </div>

                            {/* Minimal mission-control scale bar */}
                            <div
                                style={{
                                    marginTop: 10,
                                    height: 3,
                                    width: '100%',
                                    borderRadius: 999,
                                    background: 'rgba(148, 163, 184, 0.16)',
                                    overflow: 'hidden'
                                }}
                            >
                                <div
                                    style={{
                                        height: '100%',
                                        width: `${pct}%`,
                                        borderRadius: 999,
                                        background: item.isHeart
                                            ? 'linear-gradient(90deg, #dc2626, #f87171)'
                                            : abnormal
                                                ? '#ef4444'
                                                : '#38bdf8',
                                        transition: 'width 0.35s ease'
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {vitals.timestamp && (
                <div
                    style={{
                        marginTop: 14,
                        paddingTop: 10,
                        borderTop: '1px solid rgba(125, 181, 220, 0.12)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 8,
                        color: 'var(--text-secondary, #91a9c2)',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace'
                    }}
                >
                    <span>SYNC // CAIRO</span>
                    <span>
                        {new Intl.DateTimeFormat('en-GB', {
                            timeZone: 'Africa/Cairo',
                            dateStyle: 'medium',
                            timeStyle: 'medium'
                        }).format(new Date(vitals.timestamp))}
                    </span>
                </div>
            )}
        </Card>
    );
};

export default VitalsWidget;
