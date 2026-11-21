import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from '../../config';

const API = API_URL;

export default function WorkflowCenter({ astronautId, onRefresh }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState('');
    const [results, setResults] = useState({});
    const [incidentId, setIncidentId] = useState('');

    const run = async (id, task) => {
        setBusy(id);
        setResults(p => ({
            ...p,
            [id]: { status: 'RUNNING', message: 'Processing...' }
        }));

        try {
            const message = await task();
            setResults(p => ({
                ...p,
                [id]: { status: 'SUCCESS', message }
            }));
            onRefresh?.();
        } catch (e) {
            setResults(p => ({
                ...p,
                [id]: {
                    status: 'FAILED',
                    message: e.response?.data?.error || e.message
                }
            }));
        } finally {
            setBusy('');
        }
    };

    const button = (id, label, action, color) => (
        <button
            disabled={!!busy}
            onClick={action}
            style={{
                width: '100%',
                padding: '11px 12px',
                border: 0,
                borderRadius: 9,
                background: color,
                color: '#fff',
                fontWeight: 700,
                cursor: busy ? 'wait' : 'pointer',
                fontSize: 12,
                opacity: busy ? .65 : 1,
                transition: 'opacity .2s'
            }}
        >
            {busy === id ? 'Running...' : label}
        </button>
    );

    const status = id => results[id] && (
        <div style={{
            marginTop: 10,
            padding: '8px 9px',
            borderRadius: 7,
            background: results[id].status === 'SUCCESS'
                ? 'rgba(16,185,129,.10)'
                : results[id].status === 'FAILED'
                    ? 'rgba(239,68,68,.10)'
                    : 'rgba(245,158,11,.10)',
            color: results[id].status === 'SUCCESS'
                ? '#34d399'
                : results[id].status === 'FAILED'
                    ? '#f87171'
                    : '#fbbf24',
            fontSize: 11,
            lineHeight: 1.5,
            overflowWrap: 'anywhere'
        }}>
            {results[id].status}: {results[id].message}
        </div>
    );

    const card = {
        background: 'rgba(30,41,59,.72)',
        border: '1px solid rgba(148,163,184,.17)',
        borderRadius: 12,
        padding: 15,
        minWidth: 0
    };

    const description = {
        fontSize: 11,
        color: '#94a3b8',
        lineHeight: 1.6,
        minHeight: 36,
        margin: '7px 0 13px'
    };

    return (
        <div style={{
            position: 'fixed',
            left: 22,
            bottom: 22,
            zIndex: 1100,
            fontFamily: 'inherit'
        }}>
            {open && (
                <div style={{
                    width: 'min(720px, calc(100vw - 32px))',
                    maxHeight: 'min(75vh, 620px)',
                    overflowY: 'auto',
                    marginBottom: 13,
                    padding: 20,
                    boxSizing: 'border-box',
                    background: '#0b1628',
                    color: '#f8fafc',
                    border: '1px solid rgba(56,189,248,.28)',
                    borderRadius: 17,
                    boxShadow: '0 18px 55px rgba(0,0,0,.42)'
                }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        marginBottom: 17
                    }}>
                        <div>
                            <div style={{
                                fontSize: 16,
                                fontWeight: 800,
                                letterSpacing: '.02em'
                            }}>
                                Workflow Control Center
                            </div>
                            <div style={{
                                fontSize: 11,
                                color: '#94a3b8',
                                marginTop: 5
                            }}>
                                Automation Demo · {astronautId}
                            </div>
                        </div>

                        <button
                            onClick={() => setOpen(false)}
                            style={{
                                width: 34,
                                height: 34,
                                border: '1px solid #334155',
                                borderRadius: 9,
                                background: '#1e293b',
                                color: '#cbd5e1',
                                cursor: 'pointer',
                                fontSize: 16
                            }}
                        >
                            ✕
                        </button>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 12
                    }}>
                        <div style={card}>
                            <strong style={{ fontSize: 13 }}>🚨 WF01 · Health Alerts</strong>
                            <p style={description}>
                                Health Alert Orchestrator
                            </p>
                            {button('WF01', 'Trigger Health Alert', () =>
                                run('WF01', async () => {
                                    const r = await axios.post(
                                        `${API}/api/doctor/workflows/wf01/test`,
                                        { astronaut_id: astronautId },
                                        { timeout: 20000 }
                                    );

                                    if (!r.data?.success || !r.data?.queued) {
                                        throw new Error(
                                            r.data?.error || 'WF01 event was not queued.'
                                        );
                                    }

                                    return `Event queued: ${r.data.event_id} · Incident: ${r.data.incident_id || 'created'}`;
                                }),
                                '#2563eb'
                            )}
                            {status('WF01')}
                        </div>

                        <div style={card}>
                            <strong style={{ fontSize: 13 }}>🤖 WF02 · AI Assistant</strong>
                            <p style={description}>
                                AI Health Assistant integration test
                            </p>
                            {button('WF02', 'Test Assistant', () =>
                                run('WF02', async () => {
                                    const r = await axios.post(
                                        `${API}/api/doctor/health-assistant`,
                                        {
                                            astronaut_id: astronautId,
                                            question: 'Confirm the AI Health Assistant is responding. Synthetic integration test; do not provide medical advice.'
                                        },
                                        { timeout: 95000 }
                                    );

                                    return r.data?.summary ||
                                        r.data?.status ||
                                        'Response received.';
                                }),
                                '#059669'
                            )}
                            {status('WF02')}
                        </div>

                        <div style={card}>
                            <strong style={{ fontSize: 13 }}>🩺 WF03 · Medical Review</strong>
                            <p style={description}>
                                Incident acknowledgement and review actions
                            </p>

                            <input
                                value={incidentId}
                                onChange={e => setIncidentId(e.target.value)}
                                placeholder="Incident ID"
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: 10,
                                    marginBottom: 8,
                                    background: '#0f172a',
                                    color: '#fff',
                                    border: '1px solid #334155',
                                    borderRadius: 8
                                }}
                            />

                            <select
                                id="workflow-action"
                                style={{
                                    width: '100%',
                                    padding: 10,
                                    marginBottom: 10,
                                    background: '#0f172a',
                                    color: '#fff',
                                    border: '1px solid #334155',
                                    borderRadius: 8
                                }}
                            >
                                <option value="ACKNOWLEDGE">Acknowledge</option>
                                <option value="START_REVIEW">Start Review</option>
                                <option value="COMPLETE_REVIEW">Complete Review</option>
                            </select>

                            {button('WF03', 'Run Review Action', () =>
                                run('WF03', async () => {
                                    if (!incidentId.trim()) {
                                        throw new Error('Enter an Incident ID.');
                                    }

                                    const action = document.getElementById(
                                        'workflow-action'
                                    ).value;

                                    const r = await axios.post(
                                        `${API}/api/doctor/incidents/${encodeURIComponent(incidentId)}/actions`,
                                        { action, actor: 'DOCTOR' },
                                        { timeout: 35000 }
                                    );

                                    if (!(r.data?.success ||
                                        r.data?.new_status ||
                                        r.data?.status === 'SUCCESS')) {
                                        throw new Error(
                                            r.data?.error || 'Action was not confirmed.'
                                        );
                                    }

                                    return `${action} completed.`;
                                }),
                                '#7c3aed'
                            )}
                            {status('WF03')}
                        </div>

                        <div style={card}>
                            <strong style={{ fontSize: 13 }}>🧠 WF05 · Triage & Escalation</strong>
                            <p style={description}>
                                Run AI triage for a selected incident and monitor its result.
                            </p>

                            <input
                                value={incidentId}
                                onChange={e => setIncidentId(e.target.value)}
                                placeholder="Incident ID (e.g. INC-0036)"
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    padding: 10,
                                    marginBottom: 9,
                                    background: '#0f172a',
                                    color: '#fff',
                                    border: '1px solid #334155',
                                    borderRadius: 8
                                }}
                            />

                            {button('WF05_RUN', 'Run Triage for Incident', () =>
                                run('WF05_RUN', async () => {
                                    const id = incidentId.trim();
                                    if (!id) throw new Error('Enter an Incident ID.');

                                    const queued = await axios.post(
                                        `${API}/api/doctor/incidents/${encodeURIComponent(id)}/wf05-trigger`,
                                        { schema_version: '1.0' },
                                        { timeout: 15000 }
                                    );

                                    if (!queued.data?.success || !queued.data?.queued) {
                                        throw new Error(queued.data?.error || 'WF05 was not queued.');
                                    }

                                    for (let attempt = 0; attempt < 18; attempt++) {
                                        await new Promise(resolve => setTimeout(resolve, 5000));

                                        const result = await axios.get(
                                            `${API}/api/doctor/incidents/${encodeURIComponent(id)}/wf05-status`,
                                            { timeout: 12000 }
                                        );

                                        const triage = result.data?.triage || {};
                                        const jobStatus = result.data?.incident?.job_status;

                                        if (triage.brief) {
                                            return `Triage ${triage.status}: ${triage.brief.summary || 'Brief generated'} · Confidence: ${Math.round((triage.brief.confidence || 0) * 100)}%`;
                                        }

                                        if (['COMPLETED', 'FALLBACK'].includes(String(triage.status).toUpperCase())) {
                                            return `Triage finished with status: ${triage.status}. Use Sync WF05 Status to refresh details.`;
                                        }
                                    }

                                    return 'Job queued successfully. WF05 scheduler checks the queue every 60 seconds. Click Sync WF05 Status shortly to see the result.';
                                }),
                                '#0891b2'
                            )}

                            <div style={{ marginTop: 9 }}>
                                {button('WF05_SYNC', 'Sync WF05 Status', () =>
                                    run('WF05_SYNC', async () => {
                                        const id = incidentId.trim();

                                        if (id) {
                                            const r = await axios.get(
                                                `${API}/api/doctor/incidents/${encodeURIComponent(id)}/wf05-status`,
                                                { timeout: 12000 }
                                            );

                                            const triage = r.data?.triage || {};
                                            const brief = triage.brief;

                                            if (brief) {
                                                return `${triage.status} · ${brief.summary || 'Brief generated'} · Confidence: ${Math.round((brief.confidence || 0) * 100)}%`;
                                            }

                                            return `Incident ${id} · Triage: ${triage.status || 'NOT_CREATED'} · Job: ${r.data?.incident?.job_status || 'N/A'}`;
                                        }

                                        const r = await axios.get(
                                            `${API}/api/doctor/incidents`,
                                            { params: { astronaut_id: astronautId }, timeout: 15000 }
                                        );

                                        const incidents = r.data?.incidents || [];
                                        const statuses = await Promise.all(
                                            incidents.map(async incident => {
                                                try {
                                                    const result = await axios.get(
                                                        `${API}/api/doctor/incidents/${encodeURIComponent(incident.incident_id)}/wf05-status`,
                                                        { timeout: 12000 }
                                                    );
                                                    return result.data;
                                                } catch {
                                                    return null;
                                                }
                                            })
                                        );

                                        const available = statuses.filter(Boolean);
                                        const triage = available.filter(x =>
                                            x.triage?.status && x.triage.status !== 'NOT_CREATED'
                                        ).length;
                                        const escalations = available.filter(x =>
                                            String(x.escalation?.status).toUpperCase() === 'ACTIVE'
                                        ).length;

                                        return `${available.length} incidents checked · ${triage} triage records · ${escalations} active escalations`;
                                    }),
                                    '#0e7490'
                                )}
                            </div>
                            {status('WF05_RUN')}
                            {status('WF05_SYNC')}
                        </div>
                    </div>

                    <div style={{
                        fontSize: 10,
                        color: '#64748b',
                        marginTop: 15,
                        paddingTop: 12,
                        borderTop: '1px solid #1e293b'
                    }}>
                        Backend-connected workflow controls · Synthetic demo environment
                    </div>
                </div>
            )}

            <button
                onClick={() => setOpen(v => !v)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 19px',
                    borderRadius: 13,
                    background: 'linear-gradient(135deg, #0f2744, #12365b)',
                    color: '#fff',
                    border: '1px solid rgba(56,189,248,.65)',
                    boxShadow: '0 7px 25px rgba(15,39,68,.4)',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer'
                }}
            >
                <span style={{ fontSize: 16 }}>⚙</span>
                {open ? 'Close Workflow Demo' : 'Workflow Demo'}
                <span style={{
                    marginLeft: 3,
                    fontSize: 10,
                    color: '#7dd3fc'
                }}>
                    {open ? '▲' : '●'}
                </span>
            </button>
        </div>
    );
}
