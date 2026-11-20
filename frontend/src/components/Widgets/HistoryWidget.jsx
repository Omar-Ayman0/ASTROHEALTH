import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Card from '../Common/Card';

const ENGINE_URL = 'http://127.0.0.1:8000/api/v1/live/ticks';

const HistoryWidget = ({ astronautId = 'ASTRO_01' }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('All');
    const [error, setError] = useState('');

    useEffect(() => {
        fetchHistory();
        const interval = setInterval(fetchHistory, 10000);
        return () => clearInterval(interval);
    }, [astronautId]);

    const fetchHistory = async () => {
        try {
            let cursor = 0;
            let allTicks = [];
            let hasMore = true;
            let pages = 0;
            const maxPages = 20;

            while (hasMore && pages < maxPages) {
                const res = await axios.get(ENGINE_URL, {
                    params: {
                        astronaut_id: astronautId,
                        since_seq: cursor,
                        limit: 5000
                    },
                    withCredentials: false,
                timeout: 15000
                });

                const ticks = Array.isArray(res.data?.ticks)
                    ? res.data.ticks : [];

                if (!ticks.length) break;

                allTicks.push(...ticks);
                pages++;

                const nextCursor = Number(
                    res.data?.next_since_seq ??
                    Math.max(...ticks.map(t => Number(t.tick_seq) || 0))
                );

                hasMore = Boolean(res.data?.has_more);

                if (hasMore && (!Number.isFinite(nextCursor) || nextCursor <= cursor)) {
                    console.warn('Engine pagination stopped: cursor did not advance.');
                    break;
                }

                cursor = nextCursor;
            }

            const uniqueTicks = Array.from(
                new Map(allTicks.map(t => [`${t.run}-${t.tick_seq}`, t])).values()
            );

            const mapped = uniqueTicks.map(tick => ({
                id: `${tick.run}-${tick.tick_seq}`,
                timestamp: tick.timestamp,
                model_version: tick.model_version,
                heart_rate: tick.vitals?.heart_rate_bpm,
                spo2: tick.vitals?.spo2_pct,
                hrv: tick.vitals?.hrv_ms,
                temperature: tick.vitals?.skin_temp_c,
                respiratory_rate: tick.vitals?.resp_rate_bpm,
                flagged: Boolean(
                    tick.trigger_alert ||
                    tick.intelligence?.hybrid_anomaly ||
                    tick.intelligence?.stat_anomaly ||
                    tick.intelligence?.ml_anomaly ||
                    tick.intelligence?.trend_drift ||
                    tick.data_quality?.is_corrupted
                ),
                explanation: tick.intelligence?.explanation || 'No additional engine explanation.',
                data_quality: tick.data_quality?.corruption_reason || 'UNKNOWN',
                scenario: tick.demo_only_scenario_label || 'SIMULATION'
            }));

            setHistory(mapped.filter(record => record.timestamp && record.heart_rate !== undefined && record.spo2 !== undefined && record.explanation).reverse());
            setError('');
            console.info(`Engine history loaded: ${mapped.length} ticks across ${pages} page(s).`);
        } catch (err) {
            console.error('Engine history unavailable:', err);
            setError('Engine history is currently unavailable.');
        } finally {
            setLoading(false);
        }
    };

    const filteredHistory = history.filter(record => {
        if (filter === 'All') return true;
        if (filter === 'Flagged') return record.flagged;
        if (filter === 'Nominal') return !record.flagged;
        return true;
    });

    const exportToCSV = () => {
        if (!filteredHistory.length) return;

        const headers = [
            'Timestamp', 'Model Version', 'Heart Rate BPM',
            'SpO2 Percent', 'HRV ms', 'Skin Temperature C',
            'Respiratory Rate BPM', 'Engine Flagged',
            'Engine Explanation', 'Data Quality', 'Scenario'
        ];

        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

        const rows = filteredHistory.map(record => [
            record.timestamp,
            record.model_version,
            record.heart_rate,
            record.spo2,
            record.hrv,
            record.temperature,
            record.respiratory_rate,
            record.flagged,
            record.explanation,
            record.data_quality,
            record.scenario
        ].map(escape).join(','));

        const blob = new Blob(
            [[headers.map(escape).join(','), ...rows].join('\n')],
            { type: 'text/csv;charset=utf-8;' }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `engine_history_${new Date().toISOString()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const latest = history[history.length - 1];

    return (
        <Card
            title="Historical Engine Analysis (Simulation Data)"
            style={{ gridColumn: 'span 2', height: '400px', overflow: 'hidden' }}
        >
            <div style={{ marginBottom: '8px', fontSize: '0.78rem', color: '#64748b' }}>
                Source: ASTRO_01 | Engine: {latest?.model_version || 'Waiting'}
                {' | '}Historical telemetry and engine findings — not medical advice.
            </div>

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '12px'
            }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {['All', 'Flagged', 'Nominal'].map(value => (
                        <button
                            key={value}
                            onClick={() => setFilter(value)}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0',
                                background: filter === value ? '#0f172a' : 'white',
                                color: filter === value ? 'white' : '#64748b',
                                cursor: 'pointer'
                            }}
                        >
                            {value}
                        </button>
                    ))}
                </div>

                <button onClick={exportToCSV} className="btn">
                    Export CSV
                </button>
            </div>

            <div style={{ overflowY: 'auto', height: 'calc(100% - 90px)' }}>
                {loading ? (
                    <p>Loading engine history...</p>
                ) : error ? (
                    <p style={{ color: '#dc2626' }}>{error}</p>
                ) : filteredHistory.length === 0 ? (
                    <p>No engine records available for this filter.</p>
                ) : (
                    <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '0.85rem'
                    }}>
                        <thead style={{
                            position: 'sticky',
                            top: 0,
                            background: 'white',
                            zIndex: 1
                        }}>
                            <tr style={{
                                borderBottom: '2px solid #f1f5f9',
                                color: '#64748b',
                                textAlign: 'left'
                            }}>
                                <th style={{ padding: '9px' }}>Time</th>
                                <th style={{ padding: '9px' }}>Vitals</th>
                                <th style={{ padding: '9px' }}>Engine Status</th>
                                <th style={{ padding: '9px' }}>Engine Finding</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredHistory.map(record => (
                                <tr key={record.id} style={{
                                    borderBottom: '1px solid #f1f5f9'
                                }}>
                                    <td style={{ padding: '9px', whiteSpace: 'nowrap' }}>
                                        {new Date(record.timestamp).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', hour12: false })}
                                    </td>
                                    <td style={{ padding: '9px', minWidth: '180px' }}>
                                        HR: {record.heart_rate ?? 'N/A'} bpm<br />
                                        SpO2: {record.spo2 ?? 'N/A'}%<br />
                                        HRV: {record.hrv ?? 'N/A'} ms<br />
                                        Temp: {record.temperature ?? 'N/A'} °C<br />
                                        Resp: {record.respiratory_rate ?? 'N/A'} bpm
                                    </td>
                                    <td style={{
                                        padding: '9px',
                                        color: record.flagged ? '#dc2626' : '#16a34a',
                                        fontWeight: 600
                                    }}>
                                        {record.flagged ? 'FLAGGED' : 'NOMINAL'}
                                    </td>
                                    <td style={{ padding: '9px', minWidth: '180px' }}>
                                        {record.explanation}
                                        <br />
                                        <small style={{ color: '#94a3b8' }}>
                                            Data quality: {record.data_quality}
                                        </small>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </Card>
    );
};

export default HistoryWidget;






