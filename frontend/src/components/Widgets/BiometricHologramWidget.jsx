import React, { useState } from 'react';
import Card from '../Common/Card';

const HoloBodyScene = ({ vitals, isCritical, isHighRisk, compact = false }) => {
    const [activeNode, setActiveNode] = useState('heart');

    const accentColor = isCritical
        ? '#f87171'
        : isHighRisk
            ? '#fb923c'
            : '#22d3ee';

    const glowColor = isCritical
        ? 'rgba(248, 113, 113, 0.35)'
        : isHighRisk
            ? 'rgba(251, 146, 60, 0.35)'
            : 'rgba(34, 211, 238, 0.35)';

    const nodes = [
        {
            id: 'head',
            x: 100,
            y: 44,
            label: 'Skin Temp',
            value: vitals?.temperature != null ? `${vitals.temperature} °C` : '—',
            note: ' Cranial & visor thermal telemetry'
        },
        {
            id: 'heart',
            x: 112,
            y: 108,
            label: 'Heart Rate',
            value: vitals?.heart_rate != null ? `${vitals.heart_rate} BPM` : '—',
            note: 'ECG & cardiac rhythm stream'
        },
        {
            id: 'chest',
            x: 88,
            y: 118,
            label: 'Blood Oxygen',
            value: vitals?.spo2 != null ? `${vitals.spo2} %` : '—',
            note: 'SpO2 saturation & respiratory sync'
        }
    ];

    const selected = nodes.find((n) => n.id === activeNode) || nodes[1];

    return (
        <div
            style={{
                position: 'relative',
                borderRadius: 14,
                padding: compact ? 10 : 16,
                background:
                    'radial-gradient(circle at 50% 35%, rgba(34, 211, 238, 0.12), rgba(7, 17, 31, 0.85) 75%)',
                border: `1px solid ${isCritical ? 'rgba(248,113,113,0.4)' : 'rgba(56, 189, 248, 0.22)'}`,
                overflow: 'hidden'
            }}
        >
            {/* تأثير خطوط المسح الهولوجرامي */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage:
                        'repeating-linear-gradient(to bottom, rgba(34, 211, 238, 0.05) 0px, rgba(34, 211, 238, 0.05) 1px, transparent 1px, transparent 5px)',
                    pointerEvents: 'none'
                }}
            />

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: compact ? '1fr' : '1.15fr 1fr',
                    alignItems: 'center',
                    gap: compact ? 8 : 16,
                    position: 'relative',
                    zIndex: 1
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <svg
                        viewBox="0 0 200 245"
                        style={{
                            width: '100%',
                            maxWidth: compact ? 145 : 210,
                            height: 'auto',
                            filter: `drop-shadow(0 0 12px ${glowColor})`
                        }}
                    >
                        {/* حلقة قاعدة الهولوجرام */}
                        <ellipse
                            cx="100"
                            cy="226"
                            rx="58"
                            ry="11"
                            fill="none"
                            stroke={accentColor}
                            strokeWidth="1.5"
                            strokeDasharray="5 4"
                            opacity="0.8"
                        />
                        <ellipse
                            cx="100"
                            cy="226"
                            rx="36"
                            ry="6"
                            fill={glowColor}
                            opacity="0.35"
                        />

                        {/* خوذة وجسم رائد الفضاء الهولوجرامي */}
                        <circle
                            cx="100"
                            cy="44"
                            r="22"
                            fill="rgba(34, 211, 238, 0.08)"
                            stroke={accentColor}
                            strokeWidth="1.8"
                        />
                        <rect
                            x="86"
                            y="36"
                            width="28"
                            height="14"
                            rx="6"
                            fill="none"
                            stroke={accentColor}
                            strokeWidth="1.2"
                            opacity="0.85"
                        />

                        {/* الجذع */}
                        <path
                            d="M74 74 Q100 66 126 74 L132 142 L68 142 Z"
                            fill="rgba(34, 211, 238, 0.07)"
                            stroke={accentColor}
                            strokeWidth="1.8"
                        />

                        {/* الذراعان */}
                        <path
                            d="M74 78 L52 128 L61 132 L78 92"
                            fill="rgba(34, 211, 238, 0.06)"
                            stroke={accentColor}
                            strokeWidth="1.6"
                        />
                        <path
                            d="M126 78 L148 128 L139 132 L122 92"
                            fill="rgba(34, 211, 238, 0.06)"
                            stroke={accentColor}
                            strokeWidth="1.6"
                        />

                        {/* القدمان */}
                        <path
                            d="M78 142 L72 212 L86 212 L94 152"
                            fill="rgba(34, 211, 238, 0.06)"
                            stroke={accentColor}
                            strokeWidth="1.6"
                        />
                        <path
                            d="M122 142 L128 212 L114 212 L106 152"
                            fill="rgba(34, 211, 238, 0.06)"
                            stroke={accentColor}
                            strokeWidth="1.6"
                        />

                        {/* نقاط القياس الحيوية التفاعلية */}
                        {nodes.map((node) => {
                            const isSelected = activeNode === node.id;
                            const dotColor = node.id === 'heart' ? '#ef4444' : accentColor;
                            return (
                                <g
                                    key={node.id}
                                    onClick={() => setActiveNode(node.id)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <circle
                                        cx={node.x}
                                        cy={node.y}
                                        r={isSelected ? 10 : 7}
                                        fill="none"
                                        stroke={dotColor}
                                        strokeWidth="1.2"
                                        opacity={isSelected ? 0.95 : 0.55}
                                    />
                                    <circle
                                        cx={node.x}
                                        cy={node.y}
                                        r={4.2}
                                        fill={dotColor}
                                    />
                                </g>
                            );
                        })}
                    </svg>
                </div>

                {/* لوحة القراءة التفاعلية للنقطة المحددة */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div
                        style={{
                            fontSize: '0.68rem',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: accentColor,
                            fontWeight: 700
                        }}
                    >
                        HOLO-BIOMETRIC NODE
                    </div>

                    <div
                        style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            background: 'rgba(10, 24, 41, 0.8)',
                            border: '1px solid rgba(125, 181, 220, 0.16)'
                        }}
                    >
                        <div style={{ fontSize: '0.75rem', color: '#91a9c2' }}>
                            {selected.label}
                        </div>
                        <div
                            style={{
                                fontSize: compact ? '1.15rem' : '1.45rem',
                                fontWeight: 700,
                                color: '#f0f9ff',
                                marginTop: 2
                            }}
                        >
                            {selected.value}
                        </div>
                        {!compact && (
                            <div style={{ fontSize: '0.74rem', color: '#8da8c2', marginTop: 4 }}>
                                {selected.note}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {nodes.map((node) => {
                            const active = activeNode === node.id;
                            return (
                                <button
                                    key={node.id}
                                    type="button"
                                    onClick={() => setActiveNode(node.id)}
                                    style={{
                                        padding: '4px 9px',
                                        borderRadius: 999,
                                        fontSize: '0.7rem',
                                        cursor: 'pointer',
                                        border: active
                                            ? `1px solid ${accentColor}`
                                            : '1px solid rgba(125, 181, 220, 0.2)',
                                        background: active
                                            ? 'rgba(34, 211, 238, 0.16)'
                                            : 'rgba(15, 31, 51, 0.6)',
                                        color: active ? '#e8f4ff' : '#91a9c2',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    {node.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const CompactProfileHologram = ({ vitals, isCritical, isHighRisk }) => (
    <HoloBodyScene
        vitals={vitals}
        isCritical={isCritical}
        isHighRisk={isHighRisk}
        compact
    />
);

const BiometricHologramWidget = ({ vitals, anomalyData, riskData }) => {
    const isCritical = Boolean(anomalyData?.is_anomaly);
    const isHighRisk = riskData?.risk_label === 'MONITOR CLOSELY';

    return (
        <Card title="Biometric Hologram">
            <HoloBodyScene
                vitals={vitals}
                isCritical={isCritical}
                isHighRisk={isHighRisk}
                compact={false}
            />
        </Card>
    );
};

export default BiometricHologramWidget;
