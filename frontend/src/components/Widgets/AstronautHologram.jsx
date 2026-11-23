import React, { useEffect, useRef, useState } from 'react';
import { vitalSeverity, SEVERITY_COLORS } from '../../utils/vitalSeverity';
import { ASTRONAUT_MODEL_URL } from '../../config';
import './AstronautHologram.css';

const isAvailable = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const fmt = (value, digits = 1) => {
    if (value === null || value === undefined || value === '') return '\u2014';
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : '\u2014';
};

/* One limb segment: outline + dark fill + soft highlight, so the suit reads as a solid volume. */
const Tube = ({ d, w }) => (
    <g>
        <path d={d} className="holo-tube-out" style={{ strokeWidth: w }} />
        <path d={d} className="holo-tube-in" style={{ strokeWidth: w - 2.8 }} />
        <path d={d} className="holo-tube-hi" transform={`translate(${-w * 0.2} 0)`} />
    </g>
);

/* Joint ring across a limb (elbow / wrist / knee / ankle). */
const Ring = ({ x, y, w }) => (
    <rect x={x - w / 2} y={y - 3.5} width={w} height="7" rx="3.5" className="holo-ring" />
);

/*
 * Holographic EVA astronaut with live vitals callouts.
 * Display only: it reads the same `vitals` object the dashboard already builds,
 * so no API / payload / schema change is involved.
 */
const AstronautHologram = ({ astronaut, vitals = {}, isAlert = false, alertLevel = null, flaggedKeys = [] }) => {
    // The hologram colour follows the Engine Assessment so the two can never disagree:
    // NOMINAL -> cyan, MONITOR CLOSELY (alertLevel 'medium') -> amber, HIGH RISK / anomaly ('high') -> red.
    // Individual readings still get their own red box when their value is out of range.
    const level = alertLevel || (isAlert ? 'high' : null);
    const hr = Number(vitals.heart_rate);
    const beat = Number.isFinite(hr) && hr > 0
        ? Math.min(1.6, Math.max(0.4, 60 / hr))
        : 0.9;

    // 3D astronaut (three.js, loaded on demand). While it is loading, or if WebGL / the model is unavailable,
    // the SVG astronaut below stays visible, so the hologram never disappears.
    const mountRef = useRef(null);
    const sceneRef = useRef(null);
    const sceneLevel = level === 'high' || level === 'medium' ? level : null;
    const liveRef = useRef({ level: sceneLevel, beat });
    const [has3d, setHas3d] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let handle = null;
        import('./holoScene3d')
            .then((mod) => {
                if (cancelled || !mountRef.current || !mod.webglAvailable()) return;
                handle = mod.createHoloScene(mountRef.current, {
                    modelUrl: ASTRONAUT_MODEL_URL,
                    onReady: () => { if (!cancelled) setHas3d(true); },
                    onError: () => { if (!cancelled) setHas3d(false); }
                });
                sceneRef.current = handle;
                handle.update({ level: liveRef.current.level, beatSeconds: liveRef.current.beat });
            })
            .catch((err) => console.warn('3D astronaut unavailable, using 2D hologram:', err));
        return () => {
            cancelled = true;
            sceneRef.current = null;
            handle?.dispose();
        };
    }, []);

    useEffect(() => {
        liveRef.current = { level: sceneLevel, beat };
        sceneRef.current?.update({ level: sceneLevel, beatSeconds: beat });
    }, [sceneLevel, beat]);

    const CX = 200; // figure centre line
    const LEAD_X = 292; // where every leader line turns toward its row
    const ROW_X = 318; // start of the readings column

    // px/py: point on the body. ry: row of the reading (one row per reading, in the same order as the points).
    // A metric the data source did not provide is hidden instead of being shown as a dash or a made-up number.
    const readings = [
        { key: 'temp', vkey: 'temperature', raw: vitals.temperature, label: 'TEMP', value: fmt(vitals.temperature, 1), unit: '\u00B0C', px: CX + 15, py: 38, ry: 34 },
        { key: 'hr', vkey: 'heart_rate', raw: vitals.heart_rate, label: 'HR', value: fmt(vitals.heart_rate, 1), unit: 'BPM', px: CX + 18, py: 102, ry: 88 },
        { key: 'hrv', vkey: 'hrv', raw: vitals.hrv, label: 'HRV', value: fmt(vitals.hrv, 0), unit: 'ms', px: CX + 24, py: 120, ry: 142 },
        { key: 'resp', vkey: 'respiratory_rate', raw: vitals.respiratory_rate, label: 'RESP', value: fmt(vitals.respiratory_rate, 1), unit: 'br/min', px: CX + 27, py: 138, ry: 196 },
        { key: 'spo2', vkey: 'spo2', raw: vitals.spo2, label: 'SpO2', value: fmt(vitals.spo2, 0), unit: '%', px: CX + 54, py: 186, ry: 250 }
    ].filter((r) => isAvailable(r.raw));

    const label = readings.map((r) => `${r.label} ${r.value} ${r.unit}`.trim()).join(', ') || 'no telemetry available';
    // name and ID both come from the same astronaut id, so they can never disagree with each other or the header
    const id = astronaut?.id || '';
    const name = id ? id.replace('_', ' ') : (astronaut?.name || 'ASTRONAUT');

    return (
        <div
            className={`astro-holo${level === 'high' ? ' is-alert' : level === 'medium' ? ' is-warn' : ''}${has3d ? ' has-3d' : ''}`}
            style={{ '--beat': `${beat}s` }}
        >
            <div className="astro-holo-grid" aria-hidden="true" />
            <div className="astro-holo-scan" aria-hidden="true" />
            <div className="astro-holo-3d" ref={mountRef} aria-hidden="true" />

            <svg
                className="astro-holo-svg"
                viewBox="0 0 400 300"
                role="img"
                aria-label={`Holographic astronaut. ${label}`}
                preserveAspectRatio="xMidYMid meet"
            >
                <defs>
                    <linearGradient id="holoBody" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0" stopColor="var(--holo)" stopOpacity="0.14" />
                        <stop offset="0.45" stopColor="var(--holo)" stopOpacity="0.46" />
                        <stop offset="1" stopColor="var(--holo)" stopOpacity="0.1" />
                    </linearGradient>
                    <linearGradient id="holoVisor" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#bdf3ff" stopOpacity="0.95" />
                        <stop offset="0.35" stopColor="var(--holo)" stopOpacity="0.8" />
                        <stop offset="1" stopColor="#04162b" stopOpacity="0.98" />
                    </linearGradient>
                    <linearGradient id="holoBeam" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0" stopColor="var(--holo)" stopOpacity="0.3" />
                        <stop offset="1" stopColor="var(--holo)" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="holoScreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#031326" />
                        <stop offset="1" stopColor="#06223f" />
                    </linearGradient>
                </defs>

                {/* projection beam + platform */}
                <path d={`M${CX - 66} 270 L${CX - 40} 74 L${CX + 40} 74 L${CX + 66} 270 Z`} fill="url(#holoBeam)" />
                <g className="holo-platform" transform={`translate(${CX} 270)`}>
                    <ellipse rx="68" ry="9" fill="none" stroke="var(--holo)" strokeWidth="1.1" strokeOpacity="0.6" />
                    <ellipse className="holo-ring-dash" rx="50" ry="6" fill="none" stroke="var(--holo)" strokeWidth="1.2" strokeDasharray="5 6" />
                    <ellipse rx="32" ry="4" fill="var(--holo)" fillOpacity="0.16" />
                </g>

                {/* astronaut figure */}
                <g className="holo-figure" transform={`translate(${CX} 0)`}>
                    {/* life-support backpack */}
                    <rect x="-46" y="82" width="92" height="76" rx="12" className="holo-solid holo-back" />
                    <line x1="-46" y1="104" x2="-36" y2="104" className="holo-line holo-dim" />
                    <line x1="46" y1="104" x2="36" y2="104" className="holo-line holo-dim" />
                    <line x1="-46" y1="132" x2="-36" y2="132" className="holo-line holo-dim" />
                    <line x1="46" y1="132" x2="36" y2="132" className="holo-line holo-dim" />

                    {/* legs: thigh, shin, knee + ankle joints, boots */}
                    <Tube d="M-15 150 L-17 204" w="28" />
                    <Tube d="M15 150 L17 204" w="28" />
                    <Tube d="M-17 204 L-15 244" w="23" />
                    <Tube d="M17 204 L15 244" w="23" />
                    <Ring x={-17} y={204} w={31} />
                    <Ring x={17} y={204} w={31} />
                    <Ring x={-15} y={238} w={27} />
                    <Ring x={15} y={238} w={27} />
                    <path d="M-30 246 Q-30 242 -26 242 L-6 242 Q-2 242 -2 246 L-1 258 Q-1 264 -7 264 L-28 264 Q-34 264 -33 258 Z" className="holo-solid" />
                    <path d="M30 246 Q30 242 26 242 L6 242 Q2 242 2 246 L1 258 Q1 264 7 264 L28 264 Q34 264 33 258 Z" className="holo-solid" />
                    <line x1="-32" y1="259" x2="-2" y2="259" className="holo-line holo-dim" />
                    <line x1="2" y1="259" x2="32" y2="259" className="holo-line holo-dim" />

                    {/* arms: upper arm, forearm, elbow + wrist joints */}
                    <Tube d="M-42 98 L-54 132" w="22" />
                    <Tube d="M42 98 L54 132" w="22" />
                    <Tube d="M-54 132 L-53 166" w="19" />
                    <Tube d="M54 132 L53 166" w="19" />
                    <Ring x={-54} y={132} w={26} />
                    <Ring x={54} y={132} w={26} />
                    <Ring x={-53} y={167} w={23} />
                    <Ring x={53} y={167} w={23} />
                    {/* gloves with thumb + finger seams */}
                    <path d="M-64 172 L-42 172 L-43 194 Q-43 205 -53 205 Q-63 205 -63 194 Z" className="holo-solid" />
                    <path d="M64 172 L42 172 L43 194 Q43 205 53 205 Q63 205 63 194 Z" className="holo-solid" />
                    <ellipse cx="-43" cy="182" rx="4" ry="9" className="holo-solid" />
                    <ellipse cx="43" cy="182" rx="4" ry="9" className="holo-solid" />
                    <line x1="-58" y1="190" x2="-58" y2="202" className="holo-line holo-dim" />
                    <line x1="-53" y1="190" x2="-53" y2="204" className="holo-line holo-dim" />
                    <line x1="-48" y1="190" x2="-48" y2="202" className="holo-line holo-dim" />
                    <line x1="58" y1="190" x2="58" y2="202" className="holo-line holo-dim" />
                    <line x1="53" y1="190" x2="53" y2="204" className="holo-line holo-dim" />
                    <line x1="48" y1="190" x2="48" y2="202" className="holo-line holo-dim" />

                    {/* torso (hard upper torso, tapered to the waist) */}
                    <path
                        d="M-40 90 Q-42 78 -28 77 L28 77 Q42 78 40 90 L35 128 Q33 140 27 151 L-27 151 Q-33 140 -35 128 Z"
                        className="holo-solid"
                    />
                    <circle cx="-42" cy="93" r="12" className="holo-solid" />
                    <circle cx="42" cy="93" r="12" className="holo-solid" />
                    <ellipse cx="0" cy="151" rx="29" ry="5" className="holo-ring" />
                    <path d="M-36 138 Q0 146 36 138" className="holo-line holo-dim" fill="none" />
                    <line x1="-23" y1="82" x2="-27" y2="146" className="holo-line holo-dim" />
                    <line x1="23" y1="82" x2="27" y2="146" className="holo-line holo-dim" />

                    {/* chest control + ECG display */}
                    <rect x="-18" y="96" width="36" height="28" rx="4" fill="url(#holoScreen)" className="holo-line" />
                    <path className="holo-ecg-base" d="M-15 112 H-8 L-5 104 L-1 120 L3 100 L6 112 H15" />
                    <path
                        className="holo-ecg"
                        d="M-15 112 H-8 L-5 104 L-1 120 L3 100 L6 112 H15"
                        pathLength="100"
                    />
                    <circle cx="-9" cy="130" r="2.3" fill="var(--holo)" />
                    <circle cx="0" cy="130" r="2.3" fill="var(--holo-hot)" className="holo-blink" />
                    <circle cx="9" cy="130" r="2.3" fill="var(--holo)" />

                    {/* neck ring + helmet */}
                    <rect x="-23" y="69" width="46" height="11" rx="4.5" className="holo-solid" />
                    <ellipse cx="0" cy="40" rx="35" ry="36" className="holo-solid" />
                    <path d="M-14 8 Q0 2 14 8" className="holo-line holo-dim" fill="none" />
                    <ellipse cx="0" cy="43" rx="27" ry="24" fill="url(#holoVisor)" className="holo-line" />
                    <path d="M-17 33 Q-7 22 9 25" className="holo-visor-glint" fill="none" />
                    <path d="M12 58 Q19 54 22 47" className="holo-visor-glint holo-visor-glint-soft" fill="none" />
                    <rect x="-40" y="30" width="7" height="16" rx="3" className="holo-line" fill="none" />
                    <rect x="33" y="30" width="7" height="16" rx="3" className="holo-line" fill="none" />
                </g>

                {/* callouts: one leader line + one row per reading */}
                {readings.map((r) => {
                    const sev = vitalSeverity(r.vkey, r.raw);
                    const sevColor = SEVERITY_COLORS[sev];
                    const path = `M${r.px} ${r.py} H${LEAD_X} L${LEAD_X + 14} ${r.ry} H${ROW_X - 4}`;
                    return (
                        <g key={r.key} className={`holo-callout holo-callout-${r.key}`}>
                            {sev !== 'ok' && (
                                <rect
                                    x={ROW_X - 8}
                                    y={r.ry - 18}
                                    width="78"
                                    height="42"
                                    rx="6"
                                    className={`holo-reading-box holo-reading-box-${sev}`}
                                    style={{ '--box': sevColor }}
                                />
                            )}
                            <path d={path} className="holo-leader-halo" />
                            <path d={path} className="holo-leader" />
                            <circle cx={r.px} cy={r.py} r="9" className="holo-pulse" />
                            <circle cx={r.px} cy={r.py} r="3.2" className="holo-dot" fill={r.key === 'hr' ? 'var(--holo-hot)' : 'var(--holo)'} />
                            <text x={ROW_X} y={r.ry - 4} className="holo-label">{r.label}</text>
                            <text x={ROW_X} y={r.ry + 14} className="holo-value">
                                {r.value}
                                {r.unit && <tspan className="holo-unit" dx="3">{r.unit}</tspan>}
                            </text>
                        </g>
                    );
                })}
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
