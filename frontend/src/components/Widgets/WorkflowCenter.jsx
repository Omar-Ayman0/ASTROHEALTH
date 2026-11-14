import React, { useState } from 'react';
import axios from 'axios';

const API = 'http://localhost:4000';

export default function WorkflowCenter({ astronautId, onRefresh }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState('');
    const [results, setResults] = useState({});
    const [incidentId, setIncidentId] = useState('');

    const run = async (id, task) => {
        setBusy(id);
        setResults(p => ({ ...p, [id]: { status: 'RUNNING', message: 'Processing...' } }));
        try {
            const message = await task();
            setResults(p => ({ ...p, [id]: { status: 'SUCCESS', message } }));
            onRefresh?.();
        } catch (e) {
            setResults(p => ({
                ...p, [id]: {
                    status: 'FAILED',
                    message: e.response?.data?.error || e.message
                }
            }));
        } finally {
            setBusy('');
        }
    };

    const btn = (id, label, fn, color = '#2563eb') => (
        <button disabled={!!busy} onClick={fn} style={{
            width: '100%', padding: '10px', border: 0, borderRadius: 8,
            background: color, color: '#fff', fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer', fontSize: 12,
            opacity: busy ? .65 : 1
        }}>
            {busy === id ? 'Running...' : label}
        </button>
    );

    const status = id => results[id] && (
        <div style={{
            marginTop: 8, fontSize: 11, lineHeight: 1.5,
            color: results[id].status === 'SUCCESS' ? '#047857'
                : results[id].status === 'FAILED' ? '#dc2626' : '#b45309'
        }}>
            ● {results[id].status}: {results[id].message}
        </div>
    );

    const card = {
        background: '#fff', border: '1px solid #e2e8f0',
        borderRadius: 10, padding: 13, minWidth: 0
    };

    return (
        <div style={{
            position: 'fixed', left: 22, bottom: 22, zIndex: 1100,
            fontFamily: 'inherit'
        }}>
            {open && (
                <div style={{
                    width: 'min(680px, calc(100vw - 32px))',
                    marginBottom: 12, padding: 18,
                    background: '#fff', color: '#0f172a',
                    border: '1px solid #e2e8f0', borderRadius: 14,
                    boxShadow: '0 12px 45px rgba(0,0,0,.22)'
                }}>
                    <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', marginBottom: 14
                    }}>
                        <div>
                            <strong style={{ fontSize: 16 }}>Workflow Control Center</strong>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                                Automation Demo · {astronautId}
                            </div>
                        </div>
                        <button onClick={() => setOpen(false)} style={{
                            border: 0, background: '#f1f5f9', borderRadius: 7,
                            padding: '7px 11px', cursor: 'pointer', color: '#334155'
                        }}>✕</button>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
                        gap: 10
                    }}>
                        <div style={card}>
                            <strong style={{ fontSize: 13 }}>🚨 WF01</strong>
                            <p style={{ fontSize: 11, color: '#64748b', minHeight: 30 }}>
                                Health Alert Orchestrator
                            </p>
                            {btn('WF01', 'Trigger Health Alert', () =>
                                run('WF01', async () => {
                                    const r = await axios.post(`${API}/api/doctor/workflows/wf01/test`, {
                                        astronaut_id: astronautId
                                    }, { timeout: 20000 });

                                    if (!r.data?.success || !r.data?.queued) {
                                        throw new Error(r.data?.error || 'WF01 event was not queued.');
                                    }

                                    return `Event queued: ${r.data.event_id} · Incident: ${r.data.incident_id || 'created'}`;
                                })
                            )}
                            {status('WF01')}
                        </div>

                        <div style={card}>
                            <strong style={{ fontSize: 13 }}>🤖 WF02</strong>
                            <p style={{ fontSize: 11, color: '#64748b', minHeight: 30 }}>
                                AI Health Assistant
                            </p>
                            {btn('WF02', 'Test Assistant', () =>
                                run('WF02', async () => {
                                    const r = await axios.post(`${API}/api/doctor/health-assistant`, {
                                        astronaut_id: astronautId,
                                        question: 'Confirm the AI Health Assistant is responding. Synthetic integration test; do not provide medical advice.'
                                    }, { timeout: 95000 });
                                    return r.data?.summary || r.data?.status || 'Response received.';
                                }), '#059669'
                            )}
                            {status('WF02')}
                        </div>

                        <div style={card}>
                            <strong style={{ fontSize: 13 }}>🩺 WF03</strong>
                            <p style={{ fontSize: 11, color: '#64748b', minHeight: 30 }}>
                                Incident Medical Review
                            </p>
                            <input
                                value={incidentId}
                                onChange={e => setIncidentId(e.target.value)}
                                placeholder="Incident ID"
                                style={{
                                    width: '100%', boxSizing: 'border-box',
                                    padding: 8, marginBottom: 7,
                                    border: '1px solid #cbd5e1', borderRadius: 6
                                }}
                            />
                            <select id="workflow-action" style={{
                                width: '100%', padding: 8, marginBottom: 7,
                                border: '1px solid #cbd5e1', borderRadius: 6
                            }}>
                                <option value="ACKNOWLEDGE">Acknowledge</option>
                                <option value="START_REVIEW">Start Review</option>
                                <option value="COMPLETE_REVIEW">Complete Review</option>
                            </select>
                            {btn('WF03', 'Run Review Action', () =>
                                run('WF03', async () => {
                                    if (!incidentId.trim()) throw new Error('Enter an Incident ID.');
                                    const action = document.getElementById('workflow-action').value;
                                    const r = await axios.post(
                                        `${API}/api/doctor/incidents/${encodeURIComponent(incidentId)}/actions`,
                                        { action, actor: 'DOCTOR' },
                                        { timeout: 35000 }
                                    );
                                    if (!(r.data?.success || r.data?.new_status || r.data?.status === 'SUCCESS')) {
                                        throw new Error(r.data?.error || 'Action was not confirmed.');
                                    }
                                    return `${action} completed.`;
                                }), '#7c3aed'
                            )}
                            {status('WF03')}
                        </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 12 }}>
                        Synthetic simulation environment · Backend-connected actions.
                    </div>
                </div>
            )}

            <button onClick={() => setOpen(v => !v)} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '11px 17px', borderRadius: 25,
                background: '#0f2744', color: '#fff',
                border: '1px solid #38bdf8',
                boxShadow: '0 4px 16px rgba(15,39,68,.25)',
                fontWeight: 700, fontSize: 12, cursor: 'pointer'
            }}>
                ⚙ {open ? 'Close Workflow Demo' : 'Workflow Demo'}
            </button>
        </div>
    );
}

