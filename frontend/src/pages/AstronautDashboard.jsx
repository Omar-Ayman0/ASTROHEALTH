import HoloBody from '../components/Widgets/HoloBody';
import './AstronautDashboard.css';
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import VitalsChart from '../components/Charts/VitalsChart';
import DashboardLayout from '../components/Layout/DashboardLayout';
import Card from '../components/Common/Card';
import VitalsWidget from '../components/Widgets/VitalsWidget';
import DiagnosticsWidget from '../components/Widgets/DiagnosticsWidget';
import AISuggestionsWidget from '../components/Widgets/AISuggestionsWidget';
import AstronautProfileCard from '../components/Widgets/AstronautProfileCard';
import HistoryWidget from '../components/Widgets/HistoryWidget';
import { astronauts } from '../utils/astronauts';
import { latestValidVitals } from '../utils/latestVitals';
import { alertLevelFrom, flaggedKeysFromFeatures } from '../utils/vitalSeverity';
import { ENGINE_URL } from '../config';

const AstronautDashboard = () => {
    const { astronautId } = useParams();
    const astronaut = astronauts.find(a => a.id === astronautId);

    const [vitals, setVitals] = useState(null);
    const [riskData, setRiskData] = useState({});
    const [anomalyData, setAnomalyData] = useState({});
    const [history, setHistory] = useState({ heart_rate: [], spo2: [] });
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
                    ...latestValidVitals(recent),
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

        loadData();

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [astronautId, astronaut]);

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
    const alertLevel = alertLevelFrom(Boolean(isCritical), isHighRisk);
    const flaggedKeys = flaggedKeysFromFeatures(riskData.top_features);

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
                <AstronautProfileCard astronaut={astronaut} vitals={vitals} isAlert={Boolean(isCritical)} alertLevel={alertLevel} flaggedKeys={flaggedKeys} />
                <DiagnosticsWidget riskData={riskData} anomalyData={anomalyData} />
            </div>

            <div className="col-span-8" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <VitalsWidget vitals={vitals} alertLevel={alertLevel} flaggedKeys={flaggedKeys} />

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
                </div>
            </div>

            <div className="col-span-12" style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
                <AISuggestionsWidget
                    vitals={vitals}
                    riskData={riskData}
                    anomalyData={anomalyData}
                />
                <HistoryWidget astronautId={astronautId} />
            </div>
        </DashboardLayout>
    );
};

export default AstronautDashboard;





