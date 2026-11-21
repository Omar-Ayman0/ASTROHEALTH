import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import VitalsChart from '../components/Charts/VitalsChart';
import ChatPanel from '../components/Messaging/ChatPanel';
import DashboardLayout from '../components/Layout/DashboardLayout';
import Card from '../components/Common/Card';
import VitalsWidget from '../components/Widgets/VitalsWidget';
import DiagnosticsWidget from '../components/Widgets/DiagnosticsWidget';
import AISuggestionsWidget from '../components/Widgets/AISuggestionsWidget';
import AstronautProfileCard from '../components/Widgets/AstronautProfileCard';
import TaskWidget from '../components/Widgets/TaskWidget';
import HistoryWidget from '../components/Widgets/HistoryWidget';
import { astronauts } from '../utils/astronauts';
import { API_URL, ENGINE_URL } from '../config';

const BACKEND_URL = API_URL;

const AstronautDashboard = () => {
    const { astronautId } = useParams();
    const astronaut = astronauts.find(a => a.id === astronautId);

    const [vitals, setVitals] = useState(null);
    const [riskData, setRiskData] = useState({});
    const [anomalyData, setAnomalyData] = useState({});
    const [history, setHistory] = useState({ heart_rate: [], spo2: [] });
    const [messages, setMessages] = useState([]);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!astronaut) return;

        let cancelled = false;
        let cursor = 0;
        let cachedTicks = [];
        let inFlight = false;
        let timer = null;

        const loadData = async () => {
            if (cancelled || inFlight) return;

            inFlight = true;
            let nextDelay = 2000;

            try {
                const response = await axios.get(
                    `${ENGINE_URL}/api/v1/live/ticks`,
                    {
                        params: {
                            astronaut_id: astronautId,
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
                    setError('No telemetry readings are available for this astronaut.');
                    return;
                }

                setError('');

                const recent = cachedTicks;
                const latest = recent[recent.length - 1];
                const reading = latest.vitals || {};
                const intelligence = latest.intelligence || {};
                const zscores = latest.zscores || {};

                setHistory({
                    heart_rate: recent.map(t => ({
                        timestamp: t.timestamp,
                        value: t.vitals?.heart_rate_bpm
                    })),
                    spo2: recent.map(t => ({
                        timestamp: t.timestamp,
                        value: t.vitals?.spo2_pct
                    }))
                });

                setVitals({
                    heart_rate: reading.heart_rate_bpm,
                    spo2: reading.spo2_pct,
                    temperature: reading.skin_temp_c,
                    hrv: reading.hrv_ms,
                    respiratory_rate: reading.resp_rate_bpm,
                    timestamp: latest.timestamp
                });

                const anomaly = Boolean(
                    intelligence.hybrid_anomaly ||
                    intelligence.stat_anomaly ||
                    intelligence.ml_anomaly ||
                    intelligence.trend_drift
                );

                const factors = Object.entries(zscores)
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                    .slice(0, 3)
                    .map(([key]) => key.replaceAll('_', ' '));

                setAnomalyData({
                    is_anomaly: anomaly,
                    anomaly_score: intelligence.anomaly_score
                });

                setRiskData({
                    risk_label: latest.trigger_alert || anomaly
                        ? 'MONITOR CLOSELY'
                        : 'NOMINAL',
                    top_features: factors,
                    explanation: intelligence.explanation
                });

            } catch (err) {
                console.error('Engine telemetry error:', err);
                if (!cancelled) {
                    setError('Unable to connect to the Health Intelligence Engine.');
                }
            } finally {
                inFlight = false;

                if (!cancelled) {
                    timer = setTimeout(loadData, nextDelay);
                }
            }
        };

        const loadMessages = async () => {
            try {
                const response = await axios.get(
                    `${BACKEND_URL}/api/messages/history`
                );

                if (!cancelled) {
                    setMessages(
                        Array.isArray(response.data)
                            ? [...response.data].reverse()
                            : []
                    );
                }
            } catch (err) {
                console.error('Messages loading failed:', err);
            }
        };

        loadData();
        loadMessages();

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [astronautId, astronaut]);

    const sendMessage = async (content) => {
        try {
            await axios.post(`${BACKEND_URL}/api/emergency/send`, {
                content,
                astronaut_id: astronautId
            });

            setMessages(prev => [...prev, {
                sender_role: 'Astronaut',
                content,
                timestamp: new Date().toISOString()
            }]);
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    };

    if (!astronaut) {
        return (
            <div className="container" style={{ padding: 40, textAlign: 'center' }}>
                <h2>Astronaut not found</h2>
                <a href="/">Back to Selection</a>
            </div>
        );
    }

    if (error && !vitals) {
        return (
            <div className="container" style={{ padding: 40, textAlign: 'center' }}>
                <h2>Health Telemetry Unavailable</h2>
                <p>{error}</p>
                <a href="/">Back to Selection</a>
            </div>
        );
    }

    if (!vitals) {
        return (
            <div className="container" style={{ padding: 40, textAlign: 'center' }}>
                Loading {astronautId} Health Telemetry...
            </div>
        );
    }

    const isCritical = anomalyData.is_anomaly;
    const isHighRisk = riskData.risk_label === 'MONITOR CLOSELY';

    return (
        <DashboardLayout
            title={`${astronautId.replace('_', ' ')} | Astronaut Health Dashboard`}
            className={isCritical ? 'critical-alert' : isHighRisk ? 'high-risk-alert' : ''}
            statusBadge={
                <div className={`status-badge ${isCritical ? 'status-critical' : isHighRisk ? 'status-warning' : 'status-normal'}`}>
                    SYSTEM STATUS: {riskData.risk_label}
                </div>
            }
        >
            <div className="col-span-4" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <AstronautProfileCard astronaut={astronaut} />
                <DiagnosticsWidget riskData={riskData} anomalyData={anomalyData} />
            </div>

            <div className="col-span-8" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <VitalsWidget vitals={vitals} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    <Card title="Heart Rate Trend">
                        <div style={{ height: 250 }}>
                            <VitalsChart
                                data={history.heart_rate}
                                label="Heart Rate (BPM)"
                                color="#ef4444"
                                min={40}
                                max={180}
                            />
                        </div>
                    </Card>
                    <Card title="Blood Oxygen Trend">
                        <div style={{ height: 250 }}>
                            <VitalsChart
                                data={history.spo2}
                                label="SpO2 (%)"
                                color="#06b6d4"
                                min={85}
                                max={100}
                            />
                        </div>
                    </Card>
                    <TaskWidget />
                </div>
            </div>

            <div className="col-span-12">
                <AISuggestionsWidget
                    vitals={vitals}
                    riskData={riskData}
                    anomalyData={anomalyData}
                />
                <HistoryWidget astronautId={astronautId} />
            </div>

            <div style={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 16
            }}>
                {isChatOpen && (
                    <div style={{
                        width: 'min(450px, calc(100vw - 32px))',
                        boxShadow: '0 0 20px rgba(37, 99, 235, 0.3)',
                        borderRadius: 16,
                        overflow: 'hidden',
                        border: '1px solid var(--accent-blue)'
                    }}>
                        <ChatPanel
                            role="Astronaut"
                            messages={messages}
                            onSendMessage={sendMessage}
                        />
                    </div>
                )}

                <button
                    onClick={() => setIsChatOpen(!isChatOpen)}
                    style={{
                        width: 58,
                        height: 58,
                        borderRadius: '50%',
                        background: 'var(--accent-blue)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 25
                    }}
                >
                    {isChatOpen ? '\u00D7' : '\u{1F4AC}'}
                </button>
            </div>
        </DashboardLayout>
    );
};

export default AstronautDashboard;





