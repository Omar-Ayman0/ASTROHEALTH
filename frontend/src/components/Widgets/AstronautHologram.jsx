import React from 'react';
import './AstronautHologram.css';

const fmt = (value, digits = 1) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : '\u2014';
};

/*
 * Holographic astronaut with live vitals callouts.
 * Display only: it reads the same `vitals` object the dashboard already builds,
 * so no API / payload / schema change is involved.
 */
const AstronautHologram = ({ astronaut, vitals = {}, isAlert = false }) => {
    const hr = Number(vitals.heart_rate);
    const beat = Number.isFinite(hr) && hr > 0
        ? Math.min(1.6, Math.max(0.4, 60 / hr))
        : 0.9;

    const readings = [
        { key: 'temp', label: 'TEMP', value: fmt(vitals.temperature, 1), unit: '\u00B0C', px: 235, py: 39, ly: 40 },
        { key: 'hr', label: 'HR', value: fmt(vitals.heart_rate, 1), unit: 'BPM', px: 218, py: 100, ly: 92 },
        { key: 'resp', label: 'RESP', value: fmt(vitals.respiratory_rate, 1), unit: '', px: 220, py: 116, ly: 144 },
        { key: 'spo2', label: 'SpO2', value: fmt(vitals.spo2, 0), unit: '%', px: 251, py: 156, ly: 196 }
    ];

    const label = readings.map((r) => `${r.label} ${r.value} ${r.unit}`.trim()).join(', ');
    const name = astronaut?.name || 'ASTRONAUT';
    const id = astronaut?.id || '';

    return (
        <div
            className={`astro-holo${isAlert ? ' is-alert' : ''}`}
            style={{ '--beat': `${beat}s` }}
        >
            <div className="astro-holo-grid" aria-hidden="true" />
            <div className="astro-holo-scan" aria-hidden="true" />

            <svg
                className="astro-holo-svg"
                viewBox="0 0 400 260"
                role="img"
                aria-label={`Holographic astronaut. ${label}`}
                preserveAspectRatio="xMidYMid meet"
            >
                <defs>
                    <linearGradient id="holoBody" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="var(--holo)" stopOpacity="0.55" />
                        <stop offset="1" stopColor="var(--holo)" stopOpacity="0.12" />
                    </linearGradient>
                    <linearGradient id="holoVisor" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="var(--holo)" stopOpacity="0.85" />
                        <stop offset="1" stopColor="#06182f" stopOpacity="0.95" />
                    </linearGradient>
                    <marker id="holoArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M0 0 L8 4 L0 8 z" fill="var(--holo)" />
                    </marker>
                </defs>

                {/* platform rings */}
                <g className="holo-platform" transform="translate(215 228)">
                    <ellipse rx="62" ry="8" fill="none" stroke="var(--holo)" strokeWidth="1" strokeOpacity="0.55" />
                    <ellipse className="holo-ring-dash" rx="46" ry="5.5" fill="none" stroke="var(--holo)" strokeWidth="1.2" strokeDasharray="5 6" />
                </g>

                {/* astronaut figure (local coords 200x300, scaled) */}
                <g className="holo-figure" transform="translate(137 8) scale(0.78)">
                    {/* life-support backpack */}
                    <rect x="62" y="90" width="76" height="74" rx="12" className="holo-line holo-dim" fill="none" />

                    {/* legs */}
                    <path d="M88 172 L84 222 L82 256" className="holo-tube-out" />
                    <path d="M88 172 L84 222 L82 256" className="holo-tube-in" />
                    <path d="M112 172 L116 222 L118 256" className="holo-tube-out" />
                    <path d="M112 172 L116 222 L118 256" className="holo-tube-in" />
                    <rect x="68" y="252" width="28" height="22" rx="8" className="holo-solid" />
                    <rect x="104" y="252" width="28" height="22" rx="8" className="holo-solid" />
                    <line x1="76" y1="226" x2="92" y2="226" className="holo-line holo-dim" />
                    <line x1="108" y1="226" x2="124" y2="226" className="holo-line holo-dim" />

                    {/* arms */}
                    <path d="M74 100 Q54 122 54 150 L54 184" className="holo-tube-out" />
                    <path d="M74 100 Q54 122 54 150 L54 184" className="holo-tube-in" />
                    <path d="M126 100 Q146 122 146 150 L146 184" className="holo-tube-out" />
                    <path d="M126 100 Q146 122 146 150 L146 184" className="holo-tube-in" />
                    <circle cx="54" cy="190" r="10" className="holo-solid" />
                    <circle cx="146" cy="190" r="10" className="holo-solid" />

                    {/* torso */}
                    <path
                        d="M72 92 Q100 82 128 92 L133 150 Q133 170 118 173 L82 173 Q67 170 67 150 Z"
                        className="holo-solid"
                    />
                    <line x1="69" y1="160" x2="131" y2="160" className="holo-line holo-dim" />
                    <rect x="85" y="108" width="30" height="22" rx="4" className="holo-line" fill="none" />
                    <circle cx="93" cy="119" r="2.4" fill="var(--holo)" />
                    <circle cx="100" cy="119" r="2.4" fill="var(--holo-hot)" className="holo-blink" />
                    <circle cx="107" cy="119" r="2.4" fill="var(--holo)" />
                    <circle cx="74" cy="98" r="11" className="holo-line" fill="none" />
                    <circle cx="126" cy="98" r="11" className="holo-line" fill="none" />

                    {/* neck + helmet */}
                    <ellipse cx="100" cy="85" rx="21" ry="6" className="holo-solid" />
                    <circle cx="100" cy="48" r="34" className="holo-solid" />
                    <ellipse cx="100" cy="50" rx="25" ry="21" fill="url(#holoVisor)" className="holo-line" />
                    <path d="M82 44 Q92 33 108 36" className="holo-line" fill="none" strokeOpacity="0.9" />
                    <rect x="62" y="42" width="6" height="14" rx="3" className="holo-line" fill="none" />
                    <rect x="132" y="42" width="6" height="14" rx="3" className="holo-line" fill="none" />
                </g>

                {/* callouts */}
                {readings.map((r) => (
                    <g key={r.key} className={`holo-callout holo-callout-${r.key}`}>
                        <path
                            d={`M${r.px} ${r.py} L${r.px + 24} ${r.ly} L308 ${r.ly}`}
                            className="holo-leader"
                            markerEnd="url(#holoArrow)"
                        />
                        <circle cx={r.px} cy={r.py} r="9" className="holo-pulse" />
                        <circle cx={r.px} cy={r.py} r="3.4" fill={r.key === 'hr' ? 'var(--holo-hot)' : 'var(--holo)'} />
                        <text x="318" y={r.ly - 4} className="holo-label">{r.label}</text>
                        <text x="318" y={r.ly + 13} className="holo-value">
                            {r.value}
                            {r.unit && <tspan className="holo-unit" dx="3">{r.unit}</tspan>}
                        </text>
                    </g>
                ))}
            </svg>

            <div className="astro-holo-id">
                <div className="astro-holo-name">{name}</div>
                <div className="astro-holo-idlabel">ASTRONAUT ID:</div>
                <div className="astro-holo-idvalue">{id}</div>
            </div>
        </div>
    );
};

export default AstronautHologram;
