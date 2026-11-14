import React from 'react';
import Card from '../Common/Card';

const DiagnosticsWidget = ({ riskData, anomalyData }) => {
    return (
        <Card title="AI Analysis">
            <div style={{ marginBottom: '20px' }}>
                <div className="unit">RISK ASSESSMENT</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: riskData.risk_label === 'Critical' ? 'var(--accent-red)' : riskData.risk_label === 'High' ? 'var(--accent-orange)' : 'var(--accent-green)' }}>
                    {riskData.risk_label || 'Analyzing...'}
                </div>
            </div>
            <div style={{ marginBottom: '20px' }}>
                <div className="unit">ANOMALY DETECTION</div>
                <div style={{ color: anomalyData.is_anomaly ? 'var(--accent-red)' : 'var(--text-secondary)', fontWeight: anomalyData.is_anomaly ? 600 : 400 }}>
                    {anomalyData.is_anomaly ? 'ANOMALY DETECTED' : 'Normal Pattern'}
                </div>
                {anomalyData.anomaly_score && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Score: {anomalyData.anomaly_score.toFixed(3)}</div>
                )}
            </div>
            <div>
                <div className="unit">TOP FACTORS</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {riskData.top_features?.map(f => (
                        <span key={f} className="status-badge status-warning">{f}</span>
                    ))}
                    {!riskData.top_features?.length && <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>None</span>}
                </div>
            </div>
            {riskData.probabilities && (
                <div style={{ marginTop: '20px' }}>
                    <div className="unit">PROBABILITIES</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '5px' }}>
                        {Object.entries(riskData.probabilities || {}).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>{k}</span>
                                <span>{(v * 100).toFixed(1)}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    );
};

export default DiagnosticsWidget;
