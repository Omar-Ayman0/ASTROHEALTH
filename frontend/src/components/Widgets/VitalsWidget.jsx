import React from 'react';
import Card from '../Common/Card';

const VitalsWidget = ({ vitals, onClick }) => {
    if (!vitals) return <Card title="Live Vitals">Loading...</Card>;

    const metrics = [
        ['HEART RATE', vitals.heart_rate, 'BPM'],
        ['SpO2', vitals.spo2, '%'],
        ['SKIN TEMPERATURE', vitals.temperature, '°C'],
        ['HRV', vitals.hrv, 'ms'],
        ['RESPIRATORY RATE', vitals.respiratory_rate, 'BPM']
    ];

    return (
        <Card
            title="Live Vitals"
            className={onClick ? 'clickable-card' : ''}
            style={onClick ? { cursor: 'pointer' } : {}}
            onClick={onClick}
        >
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 24
            }}>
                {metrics.map(([label, value, unit]) => (
                    <div key={label}>
                        <div className="unit">{label}</div>
                        <div className="value-display">
                            {value ?? '—'} <span className="unit">{unit}</span>
                        </div>
                    </div>
                ))}
            </div>
            {vitals.timestamp && (
                <div style={{ marginTop: 18, color: 'var(--text-secondary)', fontSize: '.8rem' }}>
                    Reading timestamp: {new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(vitals.timestamp))}
                </div>
            )}
        </Card>
    );
};

export default VitalsWidget;


