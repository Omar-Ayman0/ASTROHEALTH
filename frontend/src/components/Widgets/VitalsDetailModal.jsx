import React from 'react';
import { Line } from 'react-chartjs-2';
import Card from '../Common/Card';

const VitalsDetailModal = ({ isOpen, onClose, history }) => {
    if (!isOpen) return null;

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: true, position: 'top', labels: { color: '#cbd5e1' } }
        },
        scales: {
            x: { display: true, grid: { color: 'rgba(148, 163, 184, 0.14)' }, ticks: { color: '#a9bdd3' } },
            y: { grid: { color: 'rgba(148, 163, 184, 0.14)' }, ticks: { color: '#a9bdd3' } }
        }
    };

    const createChartData = (data, label, color) => ({
        labels: data.map((d, i) => i % 5 === 0 ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date(d.timestamp)) : ''),
        datasets: [{
            label: label,
            data: data.map(d => d.value),
            borderColor: color,
            backgroundColor: `${color}33`,
            tension: 0.4,
            pointRadius: 0,
            borderWidth: 2,
            fill: true
        }]
    });

    // Calculate statistics for each vital
    const calculateStats = (data) => {
        if (!data || data.length === 0) return null;
        const values = data.map(d => d.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
        const latest = values[values.length - 1];
        return { min, max, avg, latest, count: values.length };
    };

    const hrStats = calculateStats(history.heart_rate);
    const spo2Stats = calculateStats(history.spo2);
    const tempStats = history.temperature ? calculateStats(history.temperature) : null;
    const hrvStats = calculateStats(history.hrv);
    const respiratoryStats = calculateStats(history.respiratory_rate);

    // BP stats need special handling
    let bpStats = null;
    if (history.bp && history.bp.length > 0) {
        const sysValues = history.bp.map(d => d.sys);
        const diaValues = history.bp.map(d => d.dia);
        bpStats = {
            sys: {
                min: Math.min(...sysValues),
                max: Math.max(...sysValues),
                avg: (sysValues.reduce((a, b) => a + b, 0) / sysValues.length).toFixed(1),
                latest: sysValues[sysValues.length - 1]
            },
            dia: {
                min: Math.min(...diaValues),
                max: Math.max(...diaValues),
                avg: (diaValues.reduce((a, b) => a + b, 0) / diaValues.length).toFixed(1),
                latest: diaValues[diaValues.length - 1]
            },
            count: history.bp.length
        };
    }

    const StatCard = ({ title, stats, unit, contextLabel }) => (
        <div style={{
            padding: '15px',
            background: '#0a2440',
            borderRadius: '8px',
            border: '1px solid rgba(34, 211, 238, 0.28)',
            color: '#e0f2fe'
        }}>
            <div style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '10px', color: '#67e8f9' }}>{title}</div>
            {stats && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem' }}>
                    <div><strong>Current:</strong> {stats.latest}{unit}</div>
                    <div><strong>Average:</strong> {stats.avg}{unit}</div>
                    <div><strong>Min:</strong> {stats.min}{unit}</div>
                    <div><strong>Max:</strong> {stats.max}{unit}</div>
                    <div style={{ gridColumn: 'span 2' }}><strong>Samples:</strong> {stats.count}</div>
                    {contextLabel && (
                        <div style={{ gridColumn: 'span 2', color: '#a9bdd3', fontSize: '0.8rem' }}>
                            <em>{contextLabel}</em>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const exportToCSV = () => {
        const rows = [];

        // Header
        rows.push(['Timestamp', 'Heart Rate (BPM)', 'SpO2 (%)', 'BP Systolic (mmHg)', 'BP Diastolic (mmHg)', 'Skin Temperature (C)', 'HRV (ms)', 'Respiratory Rate (BPM)']);

        // Data rows
        const maxLength = Math.max(
            history.heart_rate?.length || 0,
            history.spo2?.length || 0,
            history.bp?.length || 0,
            history.temperature?.length || 0,
            history.hrv?.length || 0,
            history.respiratory_rate?.length || 0
        );

        for (let i = 0; i < maxLength; i++) {
            const hr = history.heart_rate?.[i];
            const spo2 = history.spo2?.[i];
            const bp = history.bp?.[i];
            const temp = history.temperature?.[i];
            const hrv = history.hrv?.[i];
            const respiratory = history.respiratory_rate?.[i];

            const timestamp = hr?.timestamp || spo2?.timestamp || bp?.timestamp || temp?.timestamp || hrv?.timestamp || respiratory?.timestamp || '';

            rows.push([
                timestamp,
                hr?.value || '',
                spo2?.value || '',
                bp?.sys || '',
                bp?.dia || '',
                temp?.value || '',
                hrv?.value || '',
                respiratory?.value || ''
            ]);
        }

        const csvContent = rows.map(row => row.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `vitals_report_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 1000, backdropFilter: 'blur(4px)'
        }} onClick={onClose}>
            <div style={{
                width: '95%', maxWidth: '1200px', maxHeight: '90vh', overflowY: 'auto',
                backgroundColor: '#040c18', borderRadius: '16px', padding: '30px',
                border: '1px solid rgba(34, 211, 238, 0.34)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.8rem' }}>Detailed Vital Signs Analysis</h2>
                        <p style={{ margin: '5px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            Comprehensive historical data and statistics
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button onClick={exportToCSV} className="btn" style={{
                            background: 'var(--accent-blue)',
                            color: 'white',
                            padding: '8px 16px',
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            border: 'none',
                            borderRadius: '8px'
                        }}>
                            Export CSV
                        </button>
                        <button onClick={onClose} className="btn" style={{
                            background: 'transparent',
                            color: 'var(--text-secondary)',
                            fontSize: '2rem',
                            padding: '0 10px',
                            cursor: 'pointer',
                            border: 'none'
                        }}>X</button>
                    </div>
                </div>

                {/* Heart Rate Section */}
                <div style={{ marginBottom: '30px' }}>
                    <h3 style={{ marginBottom: '15px', color: '#f87171', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '1rem' }}>
                        Heart Rate
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '15px' }}>
                        <Card title="Trend">
                            <div style={{ height: '200px' }}>
                                <Line data={createChartData(history.heart_rate || [], 'Heart Rate (BPM)', '#ef4444')} options={commonOptions} />
                            </div>
                        </Card>
                        <StatCard title="Statistics" stats={hrStats} unit=" BPM" contextLabel="Compare with the astronaut personal baseline provided by the engine." />
                    </div>
                </div>

                {/* SpO2 Section */}
                <div style={{ marginBottom: '30px' }}>
                    <h3 style={{ marginBottom: '15px', color: '#60a5fa', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '1rem' }}>
                        Oxygen Saturation (SpO2)
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '15px' }}>
                        <Card title="Trend">
                            <div style={{ height: '200px' }}>
                                <Line data={createChartData(history.spo2 || [], 'SpO2 (%)', '#3b82f6')} options={commonOptions} />
                            </div>
                        </Card>
                        <StatCard title="Statistics" stats={spo2Stats} unit="%" />
                    </div>
                </div>

                {/* Blood Pressure Section */}
                {bpStats && (
                    <div style={{ marginBottom: '30px' }}>
                        <h3 style={{ marginBottom: '15px', color: '#f97316', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '1rem' }}>
                            Blood Pressure
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '15px' }}>
                            <Card title="Systolic Trend">
                                <div style={{ height: '200px' }}>
                                    <Line data={createChartData(
                                        history.bp.map(d => ({ ...d, value: d.sys })),
                                        'Systolic BP (mmHg)',
                                        '#f97316'
                                    )} options={commonOptions} />
                                </div>
                            </Card>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <StatCard title="Systolic" stats={bpStats.sys} unit=" mmHg" normalRange="<120 mmHg" />
                                <StatCard title="Diastolic" stats={bpStats.dia} unit=" mmHg" normalRange="<80 mmHg" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Temperature Section */}
                {tempStats && (
                    <div style={{ marginBottom: '30px' }}>
                        <h3 style={{ marginBottom: '15px', color: '#4ade80', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '1rem' }}>
                            Skin Temperature
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '15px' }}>
                            <Card title="Trend">
                                <div style={{ height: '200px' }}>
                                    <Line data={createChartData(history.temperature || [], 'Skin Temperature (C)', '#22c55e')} options={commonOptions} />
                                </div>
                            </Card>
                            <StatCard title="Statistics" stats={tempStats} unit={" \u00B0C"} />
                        </div>
                    </div>
                )}
                {hrvStats && (
                    <div style={{ marginBottom: '30px' }}>
                        <h3 style={{ marginBottom: '15px', color: '#a78bfa', fontWeight: '700' }}>Heart Rate Variability (HRV)</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                            <Card title="HRV Trend">
                                <div style={{ height: '200px' }}>
                                    <Line data={createChartData(history.hrv || [], 'HRV (ms)', '#8b5cf6')} options={commonOptions} />
                                </div>
                            </Card>
                            <StatCard title="Statistics" stats={hrvStats} unit=" ms" />
                        </div>
                    </div>
                )}

                {respiratoryStats && (
                    <div style={{ marginBottom: '30px' }}>
                        <h3 style={{ marginBottom: '15px', color: '#2dd4bf', fontWeight: '700' }}>Respiratory Rate</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                            <Card title="Respiratory Rate Trend">
                                <div style={{ height: '200px' }}>
                                    <Line data={createChartData(history.respiratory_rate || [], 'Respiratory Rate (BPM)', '#0d9488')} options={commonOptions} />
                                </div>
                            </Card>
                            <StatCard title="Statistics" stats={respiratoryStats} unit=" BPM" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VitalsDetailModal;


