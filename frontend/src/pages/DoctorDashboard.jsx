import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import Card from '../components/Common/Card';
import { astronauts } from '../utils/astronauts';
import { alertLevelFrom, flaggedKeysFromFeatures } from '../utils/vitalSeverity';
import WorkflowCenter from '../components/Widgets/WorkflowCenter';
import NotificationBell from '../components/Notifications/NotificationBell';
import { useDoctorNotifications } from '../hooks/useDoctorNotifications';
import './DoctorDashboard.css';
import { API_URL, ENGINE_URL } from '../config';

const BACKEND_URL = API_URL;

const SectionHeader = ({ index, title, subtitle }) => (
    <div className="doc-col-full doc-section-head">
        <span className="doc-section-index">{index}</span>
        <div className="doc-section-text">
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
        </div>
        <span className="doc-section-line" aria-hidden="true" />
    </div>
);

const riskTone = (label) => (
    label === 'HIGH RISK' ? 'is-high' : label === 'MONITOR CLOSELY' ? 'is-medium' : 'is-ok'
);

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

    // Notification centre: polls the existing doctor endpoints (see hooks/useDoctorNotifications.js).
    const {
        notifications,
        unreadCount,
        unreadCritical,
        statusById,
        loading: notificationsLoading,
        error: notificationsError,
        partialFailures,
        lastUpdated: notificationsUpdated,
        alertTick,
        markRead,
        markAllRead,
        refresh: refreshNotifications
    } = useDoctorNotifications();

    // Incident that was opened from a notification (scrolled to + highlighted).
    const [focusRequest, setFocusRequest] = useState(null);
    const [highlightedIncident, setHighlightedIncident] = useState(null);
    const highlightTimer = useRef(null);

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
                    setIncidents(Array.isArray(res.data?.incidents) ? res.data.incidents : []);
                }
            } catch (err) {
                console.error('Incidents unavailable:', err);
            }
        };

        loadIncidents();
        const timer = setInterval(loadIncidents, 30000);

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

    const doctorAlertLevel = alertLevelFrom(
        riskData.risk_label === 'HIGH RISK',
        riskData.risk_label === 'MONITOR CLOSELY'
    );
    const doctorFlaggedKeys = flaggedKeysFromFeatures(riskData.top_features);

    // Incident rows + the triage/escalation state that the notification poller already fetched.
    const enrichedIncidents = useMemo(() => incidents.map(item => {
        const wf = statusById[item.incident_id];
        return wf ? { ...item, triage: wf.triage, escalation: wf.escalation } : item;
    }), [incidents, statusById]);

    // Never show a missing reading as 0: the hologram formats undefined as an em dash.
    const hologramVitals = useMemo(() => (vitals
        ? Object.fromEntries(Object.entries(vitals).map(([key, value]) => [key, value ?? undefined]))
        : undefined), [vitals]);

    // Notification click -> select the astronaut, then scroll to + highlight the incident card.
    const handleNotificationSelect = useCallback((notification) => {
        markRead(notification.key);
        const target = astronauts.find(a => a.id === notification.astronautId);
        if (target) setSelectedAstronaut(prev => (prev.id === target.id ? prev : target));
        setFocusRequest({ incidentId: notification.incidentId, nonce: Date.now() });
    }, [markRead]);

    useEffect(() => {
        if (!focusRequest) return undefined;
        let tries = 0;
        // The card may not exist yet (astronaut switch -> incidents reload), so retry for ~8 s.
        const finder = setInterval(() => {
            tries += 1;
            const el = document.getElementById(`incident-${focusRequest.incidentId}`);
            if (el) {
                clearInterval(finder);
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setHighlightedIncident(focusRequest.incidentId);
                clearTimeout(highlightTimer.current);
                highlightTimer.current = setTimeout(() => setHighlightedIncident(null), 7000);
            } else if (tries >= 40) {
                clearInterval(finder);
            }
        }, 200);
        return () => clearInterval(finder);
    }, [focusRequest]);

    useEffect(() => () => clearTimeout(highlightTimer.current), []);

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

            // WF03 (n8n) confirms with { accepted: true, persisted: true, new_status }; the backend proxy also adds `success`.
            const data = response.data || {};
            const confirmed = data.success === true
                || (data.accepted === true && data.persisted !== false)
                || Boolean(data.new_status);

            if (confirmed) {
                refreshNotifications();
                // re-read the incident list from the backend so the card shows the persisted status
                axios.get(`${BACKEND_URL}/api/doctor/incidents`, { params: { astronaut_id: selectedAstronaut.id }, timeout: 10000 })
                    .then(res => setIncidents(Array.isArray(res.data?.incidents) ? res.data.incidents : []))
                    .catch(() => {});
                setIncidents(prev => prev.map(item =>
                    item.incident_id === incident.incident_id
                        ? {
                            ...item,
                            status: data.new_status || item.status,
                            updated_at: data.updated_at || data.created_at || new Date().toISOString()
                        }
                        : item
                ));
                alert(`Incident ${incident.incident_id}: ${action} successful.`);
            } else {
                alert(data.message || data.error || 'Incident action was not confirmed by the server.');
            }
        } catch (err) {
            alert(
                err.response?.data?.message ||
                err.response?.data?.error ||
                err.message ||
                'Incident action failed'
            );
            console.error('Incident action failed:', err.response?.data || err);
        }
    };

    const telemetryReady = !loading && !error;
    const profileAlert = doctorAlertLevel === 'high';

    return (
        <DashboardLayout
            title="Medical Operations Dashboard"
            className={doctorAlertLevel === 'high' ? 'critical-alert' : doctorAlertLevel === 'medium' ? 'high-risk-alert' : ''}
            topNavActions={(
                <NotificationBell
                    notifications={notifications}
                    unreadCount={unreadCount}
                    unreadCritical={unreadCritical}
                    alertTick={alertTick}
                    loading={notificationsLoading}
                    error={notificationsError}
                    partialFailures={partialFailures}
                    lastUpdated={notificationsUpdated}
                    onSelect={handleNotificationSelect}
                    onMarkAllRead={markAllRead}
                    onRefresh={refreshNotifications}
                />
            )}
        >
            {/* 1. Crew overview + astronaut selector */}
            <section className="doc-col-full doc-overview">
                <div>
                    <span className="doc-eyebrow">Medical Officer Console</span>
                    <h2>Crew Health Monitoring</h2>
                    <p>Select an astronaut to view their live health telemetry.</p>
                </div>

                <div className="doc-overview-controls">
                    <div className={`doc-chip ${telemetryReady ? riskTone(riskData.risk_label) : ''}`}>
                        <em>Engine assessment</em>
                        <strong>{telemetryReady ? (riskData.risk_label || 'ANALYZING') : '—'}</strong>
                    </div>
                    <div className="doc-chip">
                        <em>Last telemetry</em>
                        <strong>{vitals?.timestamp ? new Date(vitals.timestamp).toLocaleTimeString() : '—'}</strong>
                    </div>
                    <label className="doc-select">
                        <em>Astronaut</em>
                        <select
                            value={selectedAstronaut.id}
                            onChange={(e) => {
                                const astronaut = astronauts.find(a => a.id === e.target.value);
                                if (astronaut) setSelectedAstronaut(astronaut);
                            }}
                        >
                            {astronauts.map(astronaut => (
                                <option key={astronaut.id} value={astronaut.id}>
                                    {astronaut.id}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </section>

            {/* 2-3. Astronaut profile / hologram + live vital signs */}
            <SectionHeader index="01" title="Astronaut Overview & Live Vital Signs" subtitle={`${selectedAstronaut.id} · real-time engine telemetry`} />

            <div className="doc-col-4 doc-stack">
                <AstronautProfileCard
                    astronaut={selectedAstronaut}
                    vitals={telemetryReady ? hologramVitals : undefined}
                    isAlert={profileAlert}
                    alertLevel={doctorAlertLevel}
                    flaggedKeys={doctorFlaggedKeys}
                />
            </div>

            <div className="doc-col-8 doc-stack">
                {loading ? (
                    <div className="doc-state">Loading {selectedAstronaut.id} telemetry...</div>
                ) : error ? (
                    <div className="doc-state is-error" role="alert">{error}</div>
                ) : (
                    <>
                        <VitalsWidget vitals={vitals} onClick={() => setIsModalOpen(true)} alertLevel={doctorAlertLevel} flaggedKeys={doctorFlaggedKeys} />
                        <div className="doc-chart-pair">
                            <Card title="Live Heart Rate Trend">
                                <div className="doc-chart"><VitalsChart data={history.heart_rate} label="Heart Rate (BPM)" color="#ef4444" min={40} max={180} /></div>
                            </Card>
                            <Card title="Live SpO2 Trend">
                                <div className="doc-chart"><VitalsChart data={history.spo2} label="SpO2 (%)" color="#06b6d4" min={80} max={100} /></div>
                            </Card>
                        </div>
                    </>
                )}
            </div>

            {/* 4-5. Medical engine analysis + current health trend assessment */}
            {telemetryReady && (
                <>
                    <SectionHeader index="02" title="Medical Engine Analysis" subtitle="Risk assessment, anomaly detection and short-term trend" />
                    <div className="doc-col-4 doc-stack">
                        <DiagnosticsWidget riskData={riskData} anomalyData={anomalyData} />
                    </div>
                    <div className="doc-col-8 doc-stack">
                        <PredictiveRiskWidget riskData={riskData} anomalyData={anomalyData} history={history} />
                    </div>
                </>
            )}

            {/* 6. Historical engine analysis (follows the selected astronaut) */}
            <SectionHeader index="03" title="Historical Engine Analysis" subtitle="Recorded engine ticks for the selected astronaut" />
            <div className="doc-col-full doc-stack">
                <HistoryWidget astronautId={selectedAstronaut.id} />
            </div>

            {/* 7-8. Medical incidents, review actions and medical orders */}
            <SectionHeader index="04" title="Medical Incidents & Review Actions" subtitle="WF05 escalations are shown on every incident that has one" />
            <div className="doc-col-8 doc-stack">
                <AlertsWidget incidents={enrichedIncidents} onAction={handleIncidentAction} highlightedId={highlightedIncident} />
            </div>
            <div className="doc-col-4 doc-stack">
                <AssignTaskWidget />
            </div>

            {telemetryReady && (
                <VitalsDetailModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    history={history}
                />
            )}

            <WorkflowCenter astronautId={selectedAstronaut.id} onRefresh={() => {
                refreshNotifications();
                axios.get(BACKEND_URL + '/api/doctor/incidents', { params: { astronaut_id: selectedAstronaut.id } })
                    .then(res => setIncidents(Array.isArray(res.data?.incidents) ? res.data.incidents : []))
                    .catch(() => {});
            }} />

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
                                        background: 'rgba(239, 68, 68, 0.2)',
                                        color: '#fecaca',
                                        border: '1px solid rgba(248, 113, 113, 0.6)',
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
                            background: '#050f1e'
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
                                        color: '#a9bdd3'
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
                                            background: isDoctor ? '#2563eb' : '#0a2440',
                                            color: isDoctor ? '#ffffff' : '#e0f2fe',
                                            padding: '12px',
                                            borderRadius: '12px',
                                            border: isDoctor ? 'none' : '1px solid rgba(34, 211, 238, 0.3)',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
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
                                        background: 'rgba(34, 197, 94, 0.16)',
                                        color: '#86efac',
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
                                background: '#071a30',
                                borderTop: '1px solid rgba(34, 211, 238, 0.22)'
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
                                            border: '1px solid rgba(34, 211, 238, 0.35)',
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
