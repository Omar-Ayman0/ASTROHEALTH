import React, { useState } from 'react';

const HoloBody = ({ heartRate, spo2, temperature, isAlert = false, compact = false }) => {
    const [selected, setSelected] = useState('heart');

    const color = isAlert ? '#f87171' : '#22d3ee';
    const glow = isAlert ? 'rgba(248, 113, 113, 0.35)' : 'rgba(34, 211, 238, 0.35)';

    const points = [
        { id: 'temp', x: 100, y: 44, label: 'Skin Temp', val: temperature != null ? `${temperature} °C` : '—' },
        { id: 'heart', x: 112, y: 108, label: 'Heart Rate', val: heartRate != null ? `${heartRate} BPM` : '—' },
        { id: 'spo2', x: 88, y: 118, label: 'SpO2', val: spo2 != null ? `${spo2} %` : '—' }
    ];

    const current = points.find((p) => p.id === selected) || points[1];

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: compact ? 'column' : 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: compact ? 8 : 16,
                padding: compact ? 8 : 12,
                borderRadius: 12,
                background: 'radial-gradient(circle at 50% 40%, rgba(34, 211, 238, 0.12), rgba(7, 17, 31, 0.75) 75%)',
                border: `1px solid ${isAlert ? 'rgba(248,113,113,0.4)' : 'rgba(34, 211, 238, 0.22)'}`
            }}
        >
            <svg
                viewBox="0 0 200 240"
                style={{
                    width: compact ? 110 : 165,
                    height: 'auto',
                    flexShrink: 0,
                    filter: `drop-shadow(0 0 10px ${glow})`
                }}
            >
                <ellipse cx="100" cy="222" rx="55" ry="10" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="4 4" />
                <circle cx="100" cy="44" r="21" fill="rgba(34, 211, 238, 0.08)" stroke={color} strokeWidth="1.8" />
                <path d="M74 74 Q100 66 126 74 L132 142 L68 142 Z" fill="rgba(34, 211, 238, 0.07)" stroke={color} strokeWidth="1.8" />
                <path d="M74 78 L52 128 L61 132 L78 92" fill="rgba(34, 211, 238, 0.06)" stroke={color} strokeWidth="1.6" />
                <path d="M126 78 L148 128 L139 132 L122 92" fill="rgba(34, 211, 238, 0.06)" stroke={color} strokeWidth="1.6" />
                <path d="M78 142 L72 210 L86 210 L94 152" fill="rgba(34, 211, 238, 0.06)" stroke={color} strokeWidth="1.6" />
                <path d="M122 142 L128 210 L114 210 L106 152" fill="rgba(34, 211, 238, 0.06)" stroke={color} strokeWidth="1.6" />

                {points.map((p) => {
                    const active = selected === p.id;
                    const dotColor = p.id === 'heart' ? '#ef4444' : color;
                    return (
                        <g key={p.id} onClick={() => setSelected(p.id)} style={{ cursor: 'pointer' }}>
                            <circle cx={p.x} cy={p.y} r={active ? 9 : 6.5} fill="none" stroke={dotColor} strokeWidth="1.2" opacity={active ? 0.95 : 0.5} />
                            <circle cx={p.x} cy={p.y} r={4} fill={dotColor} />
                        </g>
                    );
                })}
            </svg>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: compact ? 0 : 120 }}>
                <div style={{ fontSize: '0.72rem', color: '#91a9c2' }}>{current.label}</div>
                <div style={{ fontSize: compact ? '1rem' : '1.3rem', fontWeight: 700, color: '#f0f9ff' }}>
                    {current.val}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                    {points.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelected(p.id)}
                            style={{
                                padding: '3px 7px',
                                borderRadius: 6,
                                fontSize: '0.68rem',
                                cursor: 'pointer',
                                border: selected === p.id ? `1px solid ${color}` : '1px solid rgba(148,163,184,0.25)',
                                background: selected === p.id ? 'rgba(34, 211, 238, 0.16)' : 'transparent',
                                color: '#e8f4ff'
                            }}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default HoloBody;
