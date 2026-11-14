import React from 'react';
import Card from '../Common/Card';

const PredictiveRiskWidget = ({ riskData = {}, anomalyData = {}, history = {} }) => {
    const readings = (history.heart_rate || [])
        .filter(item => Number.isFinite(Number(item.value)))
        .slice(-10);

    const values = readings.map(item => Number(item.value));
    const enoughData = values.length >= 2;

    const average = enoughData
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;

    const midpoint = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, midpoint);
    const secondHalf = values.slice(midpoint);

    const averageOf = arr => arr.length
        ? arr.reduce((sum, value) => sum + value, 0) / arr.length
        : 0;

    const trend = enoughData
        ? averageOf(secondHalf) - averageOf(firstHalf)
        : null;

    const label = riskData.risk_label || 'UNKNOWN';
    const anomaly = Boolean(anomalyData.is_anomaly);

    let assessment = 'INSUFFICIENT DATA';
    let color = '#64748b';
    let factors = [];

    if (enoughData) {
        if (label === 'HIGH RISK' || anomaly || average > 100) {
            assessment = 'NEEDS ATTENTION';
            color = '#dc2626';
        } else if (label === 'MONITOR CLOSELY' || average > 85 || trend > 5) {
            assessment = 'MONITOR';
            color = '#ea580c';
        } else if (label === 'NOMINAL') {
            assessment = 'NOMINAL';
            color = '#16a34a';
        } else {
            assessment = 'UNCLASSIFIED';
        }

        if (anomaly) factors.push('Anomaly detected by the Health Engine.');
        if (label !== 'UNKNOWN') factors.push(`Engine assessment: ${label}.`);
        if (average > 100) factors.push('Average heart rate is above 100 BPM.');
        if (trend > 5) factors.push('Heart rate is trending upward.');
        if (factors.length === 0) factors.push('No abnormal trend detected in the available heart-rate readings.');
    } else {
        factors.push('More heart-rate readings are needed for trend assessment.');
    }

    return (
        <Card title="Current Health Trend Assessment">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{
                    padding: 20,
                    borderRadius: 12,
                    border: `2px solid ${color}`,
                    background: `${color}12`,
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                        CURRENT ASSESSMENT — NOT A 24-HOUR PREDICTION
                    </div>
                    <div style={{ fontSize: 25, fontWeight: 700, color }}>
                        {assessment}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                        Based on {values.length} recent heart-rate readings
                    </div>
                </div>

                <div>
                    <strong style={{ fontSize: 13 }}>Contributing Factors</strong>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                        {factors.map((factor, index) => (
                            <div key={index} style={{
                                padding: 10,
                                borderRadius: 8,
                                background: '#f1f5f9',
                                color: '#334155',
                                fontSize: 13
                            }}>
                                • {factor}
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12
                }}>
                    <div style={{ padding: 12, background: '#f1f5f9', borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 12, color: '#64748b' }}>HEART RATE TREND</div>
                        <strong>{trend === null ? '—' : `${trend > 0 ? '+' : ''}${trend.toFixed(1)} BPM`}</strong>
                    </div>
                    <div style={{ padding: 12, background: '#f1f5f9', borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 12, color: '#64748b' }}>AVERAGE HEART RATE</div>
                        <strong>{average === null ? '—' : `${average.toFixed(1)} BPM`}</strong>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default PredictiveRiskWidget;
