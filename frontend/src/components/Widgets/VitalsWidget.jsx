import React, { useState } from 'react';
import Card from '../Common/Card';

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
        unit: 'BPM',
        min: 8,
        max: 26,
        isHeart: false
    }
};

const getProgress = (val, min, max) => {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return 0;
    const ratio = ((Number(val) - min) / (max - min)) * 100;
    return Math.max(8, Math.min(100, ratio));
};

const VitalsWidget = ({ vitals, onClick }) => {
    const [activeKey, setActiveKey] = useState(null);

    if (!vitals) {
        return <Card title="ORBITAL TELEMETRY // LIVE VITALS">Syncing sensor stream...</Card>;
    }

    const items = [
        { key: 'heart_rate', value: vitals.heart_rate },
        { key: 'spo2', value: vitals.spo2 },
        { key: 'temperature', value: vitals.temperature },
        { key: 'hrv', value: vitals.hrv },
        { key: 'respiratory_rate', value: vitals.respiratory_rate }
    ];

    return (
        <Card
            title="ORBITAL TELEMETRY // LIVE VITALS"
            className={onClick ? 'clickable-card' : ''}
            style={onClick ? { cursor: 'pointer' } : {}}
            onClick={onClick}
        >
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

                    return (
                        <div
                            key={key}
                            onMouseEnter={() => setActiveKey(key)}
                            onMouseLeave={() => setActiveKey(null)}
                            style={{
                                position: 'relative',
                                padding: '13px 14px',
                                borderRadius: 12,
                                background: meta.isHeart
                                    ? isHovered
                                        ? 'linear-gradient(155deg, rgba(127, 29, 29, 0.34), rgba(15, 23, 42, 0.92))'
                                        : 'linear-gradient(155deg, rgba(127, 29, 29, 0.22), rgba(15, 23, 42, 0.85))'
                                    : isHovered
                                        ? 'linear-gradient(155deg, rgba(30, 58, 95, 0.55), rgba(15, 23, 42, 0.92))'
                                        : 'rgba(15, 23, 42, 0.72)',
                                border: `1px solid ${
                                    meta.isHeart
                                        ? isHovered
                                            ? 'rgba(248, 113, 113, 0.65)'
                                            : 'rgba(239, 68, 68, 0.38)'
                                        : isHovered
                                            ? 'rgba(125, 211, 252, 0.45)'
                                            : 'rgba(148, 163, 184, 0.18)'
                                }`,
                                boxShadow: isHovered
                                    ? meta.isHeart
                                        ? '0 14px 26px rgba(0, 0, 0, 0.35), 0 0 18px rgba(239, 68, 68, 0.16)'
                                        : '0 14px 26px rgba(0, 0, 0, 0.35)'
                                    : '0 4px 12px rgba(0, 0, 0, 0.16)',
                                transform: isHovered
                                    ? 'translateY(-4px) rotateX(5deg) rotateY(-4deg) translateZ(8px)'
                                    : 'translateY(0) rotateX(0deg) rotateY(0deg) translateZ(0px)',
                                transformStyle: 'preserve-3d',
                                transition: 'transform 0.24s ease, box-shadow 0.24s ease, border-color 0.24s ease, background 0.24s ease'
                            }}
                        >
                            {/* Top channel header */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    fontFamily: 'monospace',
                                    fontSize: '0.64rem',
                                    letterSpacing: '0.08em',
                                    color: meta.isHeart ? '#fca5a5' : '#94a3b8',
                                    marginBottom: 5
                                }}
                            >
                                <span>{meta.code}</span>
                                <span
                                    style={{
                                        width: 7,
                                        height: 7,
                                        borderRadius: '50%',
                                        backgroundColor: meta.isHeart ? '#ef4444' : '#38bdf8',
                                        boxShadow: meta.isHeart ? '0 0 8px rgba(239, 68, 68, 0.8)' : 'none'
                                    }}
                                />
                            </div>

                            {/* Metric Name */}
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

                            {/* Value & Unit */}
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: 5,
                                    color: '#f8fafc',
                                    fontSize: '1.6rem',
                                    fontWeight: 700,
                                    lineHeight: 1.15
                                }}
                            >
                                <span>{value ?? '—'}</span>
                                <span
                                    style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 500,
                                        color: '#94a3b8'
                                    }}
                                >
                                    {meta.unit}
                                </span>
                            </div>

                            {/* NASA/HUD telemetry scale bar */}
                            <div
                                style={{
                                    marginTop: 11,
                                    height: 4,
                                    borderRadius: 999,
                                    background: 'rgba(148, 163, 184, 0.16)',
                                    overflow: 'hidden'
                                }}
                            >
                                <div
                                    style={{
                                        height: '100%',
                                        width: `${progress}%`,
                                        borderRadius: 999,
                                        background: meta.isHeart
                                            ? 'linear-gradient(90deg, #dc2626, #f87171)'
                                            : 'linear-gradient(90deg, #0284c7, #38bdf8)',
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
                        borderTop: '1px solid rgba(148, 163, 184, 0.14)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 8,
                        fontFamily: 'monospace',
                        fontSize: '0.74rem',
                        color: '#94a3b8'
                    }}
                >
                    <span>DOWNLINK // CAIRO-EET</span>
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
