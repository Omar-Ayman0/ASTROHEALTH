import React, { useState } from 'react';
import Card from '../Common/Card';

const VitalsWidget = ({ vitals, onClick }) => {
    const [hoveredKey, setHoveredKey] = useState(null);

    if (!vitals) return <Card title="Live Vitals">Loading...</Card>;

    const metrics = [
        { key: 'heart_rate', label: 'Heart Rate', value: vitals.heart_rate, unit: 'BPM', accent: '#ef4444' },
        { key: 'spo2', label: 'SpO2', value: vitals.spo2, unit: '%', accent: '#38bdf8' },
        { key: 'temperature', label: 'Skin Temp', value: vitals.temperature, unit: '°C', accent: '#94a3b8' },
        { key: 'hrv', label: 'HRV', value: vitals.hrv, unit: 'ms', accent: '#94a3b8' },
        { key: 'respiratory_rate', label: 'Resp. Rate', value: vitals.respiratory_rate, unit: 'BPM', accent: '#94a3b8' }
    ];

    return (
        <Card
            title="Live Vitals"
            className={onClick ? 'clickable-card' : ''}
            style={onClick ? { cursor: 'pointer' } : {}}
            onClick={onClick}
        >
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
                    gap: 16,
                    perspective: '800px'
                }}
            >
                {metrics.map((item) => {
                    const isHovered = hoveredKey === item.key;
                    const isHeart = item.key === 'heart_rate';

                    return (
                        <div
                            key={item.key}
                            onMouseEnter={() => setHoveredKey(item.key)}
                            onMouseLeave={() => setHoveredKey(null)}
                            style={{
                                padding: '12px 14px',
                                borderRadius: '10px',
                                borderLeft: `2.5px solid ${isHeart ? 'rgba(239, 68, 68, 0.7)' : isHovered ? 'rgba(239, 68, 68, 0.45)' : 'rgba(148, 163, 184, 0.25)'}`,
                                background: isHovered
                                    ? 'linear-gradient(145deg, rgba(239, 68, 68, 0.06), rgba(148, 163, 184, 0.03))'
                                    : isHeart
                                        ? 'rgba(239, 68, 68, 0.03)'
                                        : 'transparent',
                                boxShadow: isHovered
                                    ? '0 8px 18px rgba(0, 0, 0, 0.14)'
                                    : 'none',
                                transform: isHovered
                                    ? 'translateY(-3px) rotateX(3deg) rotateY(-3deg)'
                                    : 'translateY(0) rotateX(0deg) rotateY(0deg)',
                                transformStyle: 'preserve-3d',
                                transition: 'transform 0.25s ease, background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease'
                            }}
                        >
                            <div
                                style={{
                                    fontSize: '0.72rem',
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                    color: isHeart ? '#f87171' : 'var(--text-secondary, #64748b)',
                                    marginBottom: 6,
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6
                                }}
                            >
                                {isHeart && (
                                    <span
                                        style={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: '50%',
                                            backgroundColor: '#ef4444',
                                            display: 'inline-block'
                                        }}
                                    />
                                )}
                                <span>{item.label}</span>
                            </div>

                            <div
                                style={{
                                    fontSize: '1.55rem',
                                    fontWeight: 700,
                                    lineHeight: 1.2,
                                    color: 'var(--text-primary, #0f172a)',
                                    background: 'transparent',
                                    boxShadow: 'none',
                                    padding: 0,
                                    display: 'inline-flex',
                                    alignItems: 'baseline',
                                    gap: 4
                                }}
                            >
                                <span>{item.value ?? '—'}</span>
                                <span
                                    style={{
                                        fontSize: '0.8rem',
                                        fontWeight: 500,
                                        color: 'var(--text-secondary, #64748b)'
                                    }}
                                >
                                    {item.unit}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {vitals.timestamp && (
                <div
                    style={{
                        marginTop: 16,
                        paddingTop: 12,
                        borderTop: '1px solid rgba(148, 163, 184, 0.16)',
                        color: 'var(--text-secondary, #64748b)',
                        fontSize: '0.78rem'
                    }}
                >
                    Last reading:{' '}
                    {new Intl.DateTimeFormat('en-GB', {
                        timeZone: 'Africa/Cairo',
                        dateStyle: 'medium',
                        timeStyle: 'medium'
                    }).format(new Date(vitals.timestamp))}
                </div>
            )}
        </Card>
    );
};

export default VitalsWidget;
