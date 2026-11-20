import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ChatPanel from '../components/Messaging/ChatPanel';
import AIHealthReport from '../components/Messaging/AIHealthReport';
import DashboardLayout from '../components/Layout/DashboardLayout';
import VitalsWidget from '../components/Widgets/VitalsWidget';
import VitalsChart from '../components/Charts/VitalsChart';
import DiagnosticsWidget from '../components/Widgets/DiagnosticsWidget';
import AlertsWidget from '../components/Widgets/AlertsWidget';
import VitalsDetailModal from '../components/Widgets/VitalsDetailModal';
import PredictiveRiskWidget from '../components/Widgets/PredictiveRiskWidget';
import HistoryWidget from '../components/Widgets/HistoryWidget';
import AssignTaskWidget from '../components/Widgets/AssignTaskWidget';
import AstronautProfileCard from '../components/Widgets/AstronautProfileCard';
import { astronauts } from '../utils/astronauts';
import WorkflowCenter from '../components/Widgets/WorkflowCenter';

const BACKEND_URL = 'http://localhost:4000';
const ENGINE_URL = 'http://127.0.0.1:8000';

const DoctorDashboard = () => {
    const [selectedAstronaut, setSelectedAstronaut] = useState(astronauts[0]);
    const [vitals, setVitals] = useState(null);
    const [riskData, setRiskData] = useState({});
    const [anomalyData, setAnomalyData] = useState({});
    const [history, setHistory] = useState({ heart_rate: [], spo2: [], bp: [], temperature: [], hrv: [], respiratory_rate: [] });
    const [messages, setMessages] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [incidents, setIncidents] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isAssistantOpen, setIsAssistantOpen] = useState(false);
    const [assistantMessages, setAssistantMessages] = useState([]);
    const [assistantLoading, setAssistantLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [wf05Notifications, setWf05Notifications] = useState([]);
    const [wf05Open, setWf05Open] = useState(false);
    const [wf05Read, setWf05Read] = useState(() => {
        try { return JSON.parse(localStorage.getItem('astrohealth_wf05_read') || '[]'); }
        catch { return []; }
    });

    useEffect(() => {
        let cancelled = false;

        const loadWF05 = async () => {
            try {
                const response = await axios.get(`${BACKEND_URL}/api/doctor/incidents`, { timeout: 12000 });
                const rows = (response.data?.incidents || []).slice(0, 30);

                const results = await Promise.all(rows.map(async row => {
                    try {
                        const res = await axios.get(
                            `${BACKEND_URL}/api/doctor/incidents/${encodeURIComponent(row.incident_id)}/wf05-status`,
                            { timeout: 10000 }
                        );
                        return { row, data: res.data };
                    } catch { return null; }
                }));

                if (cancelled) return;

                const notices = [];
                results.filter(Boolean).forEach(({ row, data }) => {
                    const triage = data.triage || {};
                    const escalation = data.escalation || {};
                    const incident = data.incident || {};
                    const id = row.incident_id;
                    const astronaut = row.astronaut_id || incident.astronaut_id || 'Unknown';
                    const severity = row.severity || incident.severity || 'UNKNOWN';

                    const add = (type, version, title, message, priority = 'normal') => {
                        notices.push({
                            key: `${id}:${type}:${version}`,
                            title, message, priority,
                            timestamp: row.updated_at || row.created_at
                        });
                    };

                    const ts = String(triage.status || 'NOT_CREATED').toUpperCase();

                    if (ts === 'PENDING' || ts === 'FAILED') {
                        add('triage', ts,
                            ts === 'FAILED' ? 'AI Triage Failed' : 'AI Triage Pending',
                            `${astronaut} Â· ${id} Â· ${severity}`,
                            ts === 'FAILED' ? 'high' : 'normal');
                    } else if (ts === 'COMPLETED' || ts === 'FALLBACK') {
                        add('triage', triage.generated_at || ts,
                            ts === 'COMPLETED' ? 'AI Triage Completed' : 'AI Triage Fallback',
                            `${astronaut} Â· ${id} Â· ${ts}`);
                    }

                    if (String(escalation.status).toUpperCase() === 'ACTIVE') {
                        add('escalation', `${escalation.stage}:${escalation.reminder_count}`,
                            'Active Medical Escalation',
                            `${astronaut} Â· ${id} Â· ${escalation.stage || 'ACTIVE'} Â· Reminders: ${escalation.reminder_count || 0}`,
                            'high');
                    }

                    const status = String(row.status || incident.status || '').toUpperCase();
                    if (status === 'PENDING_MEDICAL_REVIEW' || status === 'IN_REVIEW') {
                        add('review', status, 'Medical Review Required',
                            `${astronaut} Â· ${id} Â· ${status} Â· ${severity}`, 'high');
                    }
                });

                notices.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
                setWf05Notifications(notices);
            } catch (err) {
                console.error('WF05 notifications unavailable:', err);
            }
        };

        loadWF05();
        const timer = setInterval(loadWF05, 20000);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);

    const unreadWF05 = wf05Notifications.filter(n => !wf05Read.includes(n.key)).length;

    const markWF05Read = () => {
        const keys = wf05Notifications.map(n => n.key);
        setWf05Read(keys);
        localStorage.setItem('astrohealth_wf05_read', JSON.stringify(keys));
    };

    useEffect(() => {
        axios.get(`${BACKEND_URL}/api/messages/history`)
            .then(res => setMessages(Array.isArray(res.data) ? res.data.reverse() : []))
            .catch(err => console.error('Messages unavailable:', err));
    }, []);
    useEffect(() => {
        let cancelled = false;

        const loadIncidents = async () => {
            try {
                const res = await axios.get(`${BACKEND_URL}/api/doctor/incidents`, {
                    params: { astronaut_id: selectedAstronaut.id },
                    timeout: 10000
                });

                if (!cancelled) {
                    setIncidents(res.data?.incidents || []);
                }
            } catch (err) {
                console.error('Incidents unavailable:', err);
            }
        };

        loadIncidents();
        const timer = setInterval(loadIncidents, 5000);

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [selectedAstronaut.id]);

    useEffect(() => {
        let cancelled = false;
        let cursor = 0;
        let cachedTicks = [];
        let inFlight = false;
        let timer = null;

        setLoading(true);
        setError('');
        setVitals(null);
        setRiskData({});
        setAnomalyData({});
        setHistory({
            heart_rate: [],
            spo2: [],
            bp: [],
            temperature: [],
            hrv: [],
            respiratory_rate: []
        });

        const loadAstronautData = async () => {
            if (cancelled || inFlight) return;

            inFlight = true;
            let nextDelay = 2000;

            try {
                const response = await axios.get(
                    `${ENGINE_URL}/api/v1/live/ticks`,
                    {
                        params: {
                            astronaut_id: selectedAstronaut.id,
                            since_seq: cursor,
                            limit: cursor === 0 ? 5000 : 500
                        },
                        withCredentials: false,
                        timeout: 10000
                    }
                );

                if (cancelled) return;

                const data = response.data || {};
                const incoming = Array.isArray(data.ticks) ? data.ticks : [];

                if (data.gap_detected || cursor === 0) {
                    cachedTicks = incoming.slice(-50);
                } else if (incoming.length) {
                    cachedTicks = [...cachedTicks, ...incoming].slice(-50);
                }

                cursor = Number(data.next_since_seq ?? cursor);

                if (data.has_more) {
                    nextDelay = 0;
                }

                if (!cachedTicks.length) {
                    setError(`No telemetry data available for ${selectedAstronaut.id}.`);
                    return;
                }

                setError('');

                const recentTicks = cachedTicks;
                const latest = recentTicks[recentTicks.length - 1];
                const values = latest.vitals || {};
                const intelligence = latest.intelligence || {};

                const mappedVitals = {
                    heart_rate: values.heart_rate_bpm ?? null,
                    spo2: values.spo2_pct ?? null,
                    temperature: values.skin_temp_c ?? null,
                    hrv: values.hrv_ms ?? null,
                    respiratory_rate: values.resp_rate_bpm ?? null,
                    timestamp: latest.timestamp,
                    astronaut_id: selectedAstronaut.id
                };

                const heartHistory = recentTicks.map(t => ({
                    timestamp: t.timestamp,
                    value: t.vitals?.heart_rate_bpm
                })).filter(item => item.value != null);

                const spo2History = recentTicks.map(t => ({
                    timestamp: t.timestamp,
                    value: t.vitals?.spo2_pct
                })).filter(item => item.value != null);

                const hrvHistory = recentTicks.map(t => ({
                    timestamp: t.timestamp,
                    value: t.vitals?.hrv_ms
                })).filter(item => item.value != null);

                const respiratoryHistory = recentTicks.map(t => ({
                    timestamp: t.timestamp,
                    value: t.vitals?.resp_rate_bpm
                })).filter(item => item.value != null);

                const isAnomaly = Boolean(
                    intelligence.hybrid_anomaly ||
                    intelligence.stat_anomaly ||
                    intelligence.ml_anomaly ||
                    intelligence.trend_drift ||
                    latest.trigger_alert
                );

                const score = intelligence.anomaly_score ?? 0;

                setVitals(mappedVitals);

                setHistory({
                    heart_rate: heartHistory,
                    spo2: spo2History,
                    bp: [],
                    temperature: recentTicks.map(t => ({
                        timestamp: t.timestamp,
                        value: t.vitals?.skin_temp_c
                    })).filter(item => item.value != null),
                    hrv: hrvHistory,
                    respiratory_rate: respiratoryHistory
                });

                setAnomalyData({
                    is_anomaly: isAnomaly,
                    anomaly_score: score
                });

                setRiskData({
                    risk_label: latest.trigger_alert
                        ? 'HIGH RISK'
                        : isAnomaly
                            ? 'MONITOR CLOSELY'
                            : 'NOMINAL',
                    probabilities: {},
                    top_features: Object.entries(intelligence.zscores || {})
                        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                        .slice(0, 3)
                        .map(([key]) => key)
                });

            } catch (err) {
                if (!cancelled) {
                    console.error('Failed to load astronaut telemetry:', err);
                    setError('Unable to connect to the Health Intelligence Engine.');
                }
            } finally {
                inFlight = false;

                if (!cancelled) {
                    setLoading(false);
                    timer = setTimeout(loadAstronautData, nextDelay);
                }
            }
        };

        loadAstronautData();

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [selectedAstronaut]);

    const clearChat = async () => {
    if (!window.confirm('Clear the conversation for both doctor and astronaut?')) return;
    try {
        await axios.delete(`${BACKEND_URL}/api/messages/clear`, {
            data: { role: 'Doctor' }
        });
        setMessages([]);
    } catch (err) {
        alert(err.response?.data?.error || 'Could not clear chat.');
    }
};
const sendMessage = async (content) => {
        try {
            await axios.post(`${BACKEND_URL}/api/precaution/send`, { content });
            setMessages(prev => [...prev, {
                sender_role: 'Doctor',
                content,
                timestamp: new Date().toISOString()
            }]);
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    };


    const sendAssistantMessage = async (content) => {
        if (!content.trim() || assistantLoading) return;

        const question = content.trim();

        if (/([\u0600-\u06FFa-zA-Z])\1{3,}/i.test(question)) {
            setAssistantMessages(prev => [
                ...prev,
                {
                    sender_role: 'Doctor',
                    content: question,
                    timestamp: new Date().toISOString()
                },
                {
                    sender_role: 'AI Assistant',
                    content: 'Hello Doctor! I am your AI Health Assistant. How can I help?',
                    timestamp: new Date().toISOString()
                }
            ]);
            return;
        }
        const normalizedGreeting = question.toLowerCase().trim();

        const greetingReplies = {
            hello: 'Hello Doctor! I am your AI Health Assistant. How can I help?',
            hi: 'Hi Doctor! How can I assist you today?',
            'good morning': 'Good morning, Doctor! How can I help?'
        };

        if (greetingReplies[normalizedGreeting]) {
            const timestamp = new Date().toISOString();

            setAssistantMessages(prev => [
                ...prev,
                {
                    sender_role: 'Doctor',
                    content: question,
                    timestamp
                },
                {
                    sender_role: 'AI Assistant',
                    content: greetingReplies[normalizedGreeting],
                    timestamp
                }
            ]);

            return;
        }
        setAssistantMessages(prev => [...prev, {
            sender_role: 'Doctor',
            content: question,
            timestamp: new Date().toISOString()
        }]);

        setAssistantLoading(true);

        try {
            const response = await axios.post(
                `${BACKEND_URL}/api/doctor/health-assistant`,
                {
                    astronaut_id: selectedAstronaut.id,
                    question
                },
                { timeout: 95000 }
            );

            const payload = response.data || {};
            const answerValue =
                payload.answer ||
                payload.response ||
                payload.report ||
                payload.message ||
                payload.findings ||
                payload;

            const answer = answerValue;

            setAssistantMessages(prev => [...prev, {
                sender_role: 'AI Assistant',
                content: answer,
                timestamp: new Date().toISOString()
            }]);

        } catch (err) {
            const errorMessage =
                err.response?.data?.error ||
                err.message ||
                'Could not contact AI Assistant';

            setAssistantMessages(prev => [...prev, {
                sender_role: 'AI Assistant',
                content: 'Automation error: ' + errorMessage,
                timestamp: new Date().toISOString()
            }]);

            console.error('AI Assistant error:', err);

        } finally {
            setAssistantLoading(false);
        }
    };

    const handleIncidentAction = async (incident, action) => {
        const confirmed = window.confirm(
            `Confirm ${action.replaceAll('_', ' ')} for ${incident.incident_id}?`
        );
        if (!confirmed) return;

        try {
            const response = await axios.post(
                `${BACKEND_URL}/api/doctor/incidents/${encodeURIComponent(incident.incident_id)}/actions`,
                { action, actor: 'DOCTOR' },
                { timeout: 35000 }
            );

            if (response.data?.success) {
                setIncidents(prev => prev.map(item =>
                    item.incident_id === incident.incident_id
                        ? {
                            ...item,
                            status: response.data.new_status || item.status,
                            updated_at: response.data.created_at || new Date().toISOString()
                        }
                        : item
                ));
                alert(`Incident ${incident.incident_id}: ${action} successful.`);
            } else {
                alert(response.data?.error || 'Incident action was not confirmed by the server.');
            }
        } catch (err) {
            alert(
                err.response?.data?.error ||
                err.response?.data?.message ||
                err.message ||
                'Incident action failed'
            );
            console.error('Incident action failed:', err.response?.data || err);
        }
    };

    return (
        <DashboardLayout title="Medical Operations Dashboard">
            <div style={{
                padding: '20px 24px',
                marginBottom: '20px',
                background: 'var(--card-bg, #111c30)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                borderRadius: '14px'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '16px'
                }}>
                    <div>
                        <h2 style={{ margin: 0, color: 'var(--text-primary, #fff)' }}>
                            Crew Health Monitoring
                        </h2>
                        <p style={{ margin: '6px 0 0', color: 'var(--text-secondary, #94a3b8)' }}>
                            Select an astronaut to view their live health telemetry.
                        </p>
                    </div>

                    <select
                        value={selectedAstronaut.id}
                        onChange={(e) => {
                            const astronaut = astronauts.find(a => a.id === e.target.value);
                            if (astronaut) setSelectedAstronaut(astronaut);
                        }}
                        style={{
                            minWidth: '220px',
                            padding: '12px 16px',
                            borderRadius: '9px',
                            border: '1px solid #38bdf8',
                            background: '#0f172a',
                            color: '#fff',
                            fontSize: '15px',
                            fontWeight: '600',
                            cursor: 'pointer'
                        }}
                    >
                        {astronauts.map(astronaut => (
                            <option key={astronaut.id} value={astronaut.id}>
                                {astronaut.id}
                            </option>
                        ))}
                    </select>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginLeft: 10, zIndex: 50 }}>
                        <button
                            type="button"
                            aria-label="Medical notifications"
                            onClick={() => {
                                const opening = !wf05Open;
                                setWf05Open(opening);
                                if (opening) markWF05Read();
                            }}
                            style={{
                                position: 'relative', width: 46, height: 46,
                                borderRadius: 12, border: '1px solid #38bdf8',
                                background: '#0f172a', color: 'white',
                                fontSize: 22, cursor: 'pointer'
                            }}
                        >
                            &#128276;”
                            {unreadWF05 > 0 && (
                                <span style={{
                                    position: 'absolute', top: -7, right: -7,
                                    background: '#ef4444', color: 'white',
                                    borderRadius: 20, minWidth: 20, padding: '2px 5px',
                                    fontSize: 11, fontWeight: 800
                                }}>{unreadWF05 > 99 ? '99+' : unreadWF05}</span>
                            )}
                        </button>

                        {wf05Open && (
                            <div style={{
                                position: 'absolute', right: 0, top: 55,
                                width: 'min(380px, calc(100vw - 35px))',
                                maxHeight: 420, overflowY: 'auto', zIndex: 2000,
                                background: '#0f172a', color: 'white',
                                border: '1px solid #334155', borderRadius: 12,
                                boxShadow: '0 12px 35px rgba(0,0,0,.4)'
                            }}>
                                <div style={{
                                    padding: 14, display: 'flex',
                                    justifyContent: 'space-between',
                                    borderBottom: '1px solid #334155'
                                }}>
                                    <strong>WF05 Medical Notifications</strong>
                                    <button type="button" onClick={() => setWf05Open(false)}
                                        style={{ background: 'none', border: 0, color: 'white', cursor: 'pointer' }}>&#10005;</button>
                                </div>
                                {wf05Notifications.length === 0 ? (
                                    <p style={{ padding: 18, color: '#94a3b8' }}>No WF05 notifications.</p>
                                ) : wf05Notifications.map(n => (
                                    <div key={n.key} style={{
                                        padding: 13, borderBottom: '1px solid #334155',
                                        borderLeft: n.priority === 'high' ? '3px solid #f59e0b' : '3px solid #38bdf8'
                                    }}>
                                        <strong style={{ fontSize: 13 }}>{n.title}</strong>
                                        <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 5 }}>{n.message}</div>
                                        <div style={{ color: '#64748b', fontSize: 10, marginTop: 5 }}>
                                            {n.timestamp ? new Date(n.timestamp).toLocaleString() : 'Live status'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: '50px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    Loading {selectedAstronaut.id} telemetry...
                </div>
            ) : error ? (
                <div style={{
                    padding: '24px',
                    margin: '20px 0',
                    borderRadius: '12px',
                    background: 'rgba(220, 38, 38, 0.1)',
                    border: '1px solid rgba(220, 38, 38, 0.4)',
                    color: '#fca5a5'
                }}>
                    {error}
                </div>
            ) : (
                <>
                    <div className="col-span-5" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '24px'
                    }}>
                        <AstronautProfileCard astronaut={selectedAstronaut} />
                        <VitalsWidget vitals={vitals} onClick={() => setIsModalOpen(true)} />
                        <div style={{ background: '#ffffff', border: '1px solid var(--border-color, #334155)', borderRadius: '12px', padding: '18px' }}>
                            <h3>Live Heart Rate Trend</h3>
                            <VitalsChart data={history.heart_rate} label="Heart Rate" color="#1e293b" min={40} max={180} />
                            <h3 style={{ marginTop: '20px' }}>Live SpO2 Trend</h3>
                            <VitalsChart data={history.spo2} label="SpO2" color="#1e293b" min={80} max={100} />
                        </div>
                        <AlertsWidget incidents={incidents} onAction={handleIncidentAction} />
                    </div>

                    <div className="col-span-7" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '24px'
                    }}>
                        <PredictiveRiskWidget
                            riskData={riskData}
                            anomalyData={anomalyData}
                            history={history}
                        />
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                            gap: '24px'
                        }}>
                            <DiagnosticsWidget riskData={riskData} anomalyData={anomalyData} />
                            <AssignTaskWidget />
                        </div>
                        <HistoryWidget />
                    </div>

                    <VitalsDetailModal
                        isOpen={isModalOpen}
                        onClose={() => setIsModalOpen(false)}
                        history={history}
                    />
                </>
            )}

            <WorkflowCenter astronautId={selectedAstronaut.id} onRefresh={() => axios.get(BACKEND_URL + '/api/doctor/incidents', { params: { astronaut_id: selectedAstronaut.id } }).then(res => setIncidents(res.data?.incidents || [])).catch(() => {})} />

            <div style={{
                position: 'fixed',
                bottom: '24px',
                right: '24px',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '16px'
            }}>
                {isAssistantOpen && (
                    <div style={{
                        width: 'min(450px, calc(100vw - 32px))',
                        boxShadow: '0 0 20px rgba(16, 185, 129, 0.3)',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        border: '1px solid #10b981'
                    }}>
                        <div style={{
                            padding: '10px 14px',
                            background: '#064e3b',
                            color: 'white',
                            fontWeight: '700',
                            display: 'flex',
                            justifyContent: 'space-between'
                        }}>
                            <span>AI Health Assistant - {selectedAstronaut.id}</span>

                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px'
                            }}>
                                <span style={{ fontSize: '11px' }}>
                                    {assistantLoading ? 'Analyzing...' : 'Ready'}
                                </span>

                                <button
                                    onClick={() => {
                                        if (assistantLoading) return;

                                        if (window.confirm('Are you sure you want to clear this conversation?')) {
                                            setAssistantMessages([]);
                                        }
                                    }}
                                    disabled={assistantLoading}
                                    style={{
                                        background: '#ffffff',
                                        color: '#991b1b',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '6px 9px',
                                        fontSize: '11px',
                                        fontWeight: '700',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Clear Chat
                                </button>
                            </div>
                        </div>
                        <div style={{
                            height: '450px',
                            display: 'flex',
                            flexDirection: 'column',
                            background: '#f8fafc'
                        }}>
                            <div style={{
                                flex: 1,
                                overflowY: 'auto',
                                padding: '14px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px'
                            }}>
                                {assistantMessages.length === 0 && (
                                    <div style={{
                                        margin: 'auto',
                                        textAlign: 'center',
                                        color: '#94a3b8'
                                    }}>
                                        <div style={{ fontSize: '30px' }}>+</div>
                                        <div style={{ fontWeight: '700' }}>
                                            AI Medical Assistant
                                        </div>
                                        <div style={{ fontSize: '12px', marginTop: '5px' }}>
                                            Ask a health question about the selected astronaut.
                                        </div>
                                    </div>
                                )}

                                {assistantMessages.map((msg, index) => {
                                    const isDoctor = msg.sender_role === 'Doctor';
                                    const isReport = !isDoctor &&
                                        typeof msg.content === 'object' &&
                                        msg.content !== null &&
                                        !Array.isArray(msg.content);

                                    return (
                                        <div key={index} style={{
                                            alignSelf: isDoctor ? 'flex-end' : 'stretch',
                                            maxWidth: isDoctor ? '85%' : '100%',
                                            background: isDoctor ? '#2563eb' : '#ffffff',
                                            color: isDoctor ? '#ffffff' : '#1e293b',
                                            padding: '12px',
                                            borderRadius: '12px',
                                            border: isDoctor ? 'none' : '1px solid #e2e8f0',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                                            overflowWrap: 'anywhere'
                                        }}>
                                            <div style={{
                                                fontSize: '10px',
                                                fontWeight: '800',
                                                marginBottom: '8px',
                                                opacity: 0.75,
                                                textTransform: 'uppercase'
                                            }}>
                                                {msg.sender_role} | {new Date(msg.timestamp).toLocaleTimeString()}
                                            </div>

                                            {isReport ? (
                                                <AIHealthReport report={
                                                    msg.content.report ||
                                                    msg.content.answer ||
                                                    msg.content.response ||
                                                    msg.content.data ||
                                                    msg.content
                                                } />
                                            ) : (
                                                <div style={{
                                                    whiteSpace: 'pre-wrap',
                                                    fontSize: '13px',
                                                    lineHeight: 1.6
                                                }}>
                                                    {typeof msg.content === 'string'
                                                        ? msg.content
                                                        : JSON.stringify(msg.content, null, 2)}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {assistantLoading && (
                                    <div style={{
                                        alignSelf: 'flex-start',
                                        padding: '10px 14px',
                                        background: '#ecfdf5',
                                        color: '#047857',
                                        borderRadius: '10px',
                                        fontSize: '12px',
                                        fontWeight: '700'
                                    }}>
                                        Analyzing astronaut health data...
                                    </div>
                                )}
                            </div>

                            <div style={{
                                padding: '12px',
                                background: '#ffffff',
                                borderTop: '1px solid #e2e8f0'
                            }}>
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        const input = e.currentTarget.elements.assistantQuestion;
                                        if (input.value.trim() && !assistantLoading) {
                                            sendAssistantMessage(input.value);
                                            input.value = '';
                                        }
                                    }}
                                    style={{ display: 'flex', gap: '8px' }}
                                >
                                    <input
                                        name="assistantQuestion"
                                        type="text"
                                        placeholder="Ask AI about astronaut health..."
                                        disabled={assistantLoading}
                                        style={{
                                            flex: 1,
                                            minWidth: 0,
                                            padding: '11px',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '8px',
                                            outline: 'none'
                                        }}
                                    />
                                    <button
                                        type="submit"
                                        disabled={assistantLoading}
                                        style={{
                                            padding: '10px 15px',
                                            background: '#059669',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '8px',
                                            fontWeight: '700',
                                            cursor: assistantLoading ? 'not-allowed' : 'pointer',
                                            opacity: assistantLoading ? 0.6 : 1
                                        }}
                                    >
                                        Send
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                )}

                {isChatOpen && (
                    <div style={{
                        width: 'min(450px, calc(100vw - 32px))',
                        boxShadow: '0 0 20px rgba(37, 99, 235, 0.3)',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        border: '1px solid var(--accent-blue)'
                    }}>
                        <ChatPanel
                            role="Doctor"
                            messages={messages}
                            onSendMessage={sendMessage}
                            onClearMessages={clearChat}
                        />
                    </div>
                )}

                <button
                    onClick={() => setIsAssistantOpen(!isAssistantOpen)}
                    aria-label="Toggle AI Health Assistant"
                    style={{
                        padding: '12px 18px',
                        borderRadius: '24px',
                        background: '#059669',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: '700',
                        boxShadow: '0 4px 12px rgba(5, 150, 105, 0.3)'
                    }}
                >
                    {isAssistantOpen ? 'Close AI' : 'AI Assistant'}
                </button>

                <button
                    onClick={() => setIsChatOpen(!isChatOpen)}
                    aria-label={isChatOpen ? '\u00D7' : '\u{1F4AC}'}
                    style={{
                        width: '58px',
                        height: '58px',
                        borderRadius: '50%',
                        background: 'var(--accent-blue)',
                        color: 'white',
                        border: 'none',
                        boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
                        cursor: 'pointer',
                        fontSize: '1.5rem'
                    }}
                >
                    {isChatOpen ? '\u00D7' : '\u{1F4AC}'}
                </button>
            </div>
        </DashboardLayout>
    );
};

export default DoctorDashboard;

















