import React from 'react';
import Card from '../Common/Card';

import { generateSuggestions } from '../../utils/aiLogic';

const AISuggestionsWidget = ({ vitals, riskData, anomalyData }) => {
    if (!vitals || !riskData) return <Card title="AI Health Assistant">Loading...</Card>;

    const { suggestions, precautions } = generateSuggestions(vitals, riskData, anomalyData);

    const getRiskColor = () => {
        if (riskData.risk_label === 'Critical') return '#dc2626';
        if (anomalyData?.is_anomaly) return '#ea580c';
        if (riskData.risk_label === 'High') return '#ea580c';
        return '#16a34a';
    };

    return (
        <Card title="AI Health Assistant" style={{ gridRow: 'span 2' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                {/* Status Indicator */}
                <div style={{
                    padding: '12px',
                    background: `linear-gradient(135deg, ${getRiskColor()}15 0%, ${getRiskColor()}08 100%)`,
                    borderRadius: '8px',
                    border: `2px solid ${getRiskColor()}`,
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Current Health Status
                    </div>
                    <div style={{ fontSize: '1.3rem', fontWeight: '700', color: getRiskColor() }}>
                        {riskData.risk_label === 'Critical' ? 'Critical' :
                            anomalyData?.is_anomaly ? 'Attention Needed' :
                                riskData.risk_label === 'Low' ? 'Excellent' :
                                    riskData.risk_label === 'Medium' ? 'Fair' :
                                        riskData.risk_label === 'High' ? 'Poor' :
                                            riskData.risk_label}
                    </div>
                </div>

                {/* AI Suggestions */}
                <div>
                    <div style={{
                        fontSize: '0.875rem',
                        fontWeight: '700',
                        marginBottom: '10px',
                        color: '#1e293b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                    }}>
                        AI Recommendations
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {suggestions.map((suggestion, idx) => (
                            <div key={idx} style={{
                                fontSize: '0.85rem',
                                padding: '10px 12px',
                                background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                                borderRadius: '8px',
                                border: '1px solid #bae6fd',
                                color: '#0c4a6e',
                                lineHeight: '1.5'
                            }}>
                                {suggestion}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Precautions */}
                {precautions.length > 0 && (
                    <div>
                        <div style={{
                            fontSize: '0.875rem',
                            fontWeight: '700',
                            marginBottom: '10px',
                            color: '#1e293b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                        }}>
                            Safety Precautions
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {precautions.map((precaution, idx) => (
                                <div key={idx} style={{
                                    fontSize: '0.825rem',
                                    padding: '8px 12px',
                                    background: precaution.includes('CRITICAL') || precaution.includes('IMPORTANT') || precaution.includes('MANDATORY')
                                        ? 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)'
                                        : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                                    borderRadius: '6px',
                                    border: precaution.includes('CRITICAL') || precaution.includes('IMPORTANT') || precaution.includes('MANDATORY')
                                        ? '1px solid #fbbf24'
                                        : '1px solid #e2e8f0',
                                    color: precaution.includes('CRITICAL') || precaution.includes('IMPORTANT') || precaution.includes('MANDATORY')
                                        ? '#92400e'
                                        : '#475569',
                                    lineHeight: '1.4',
                                    fontWeight: precaution.includes('CRITICAL') || precaution.includes('IMPORTANT') || precaution.includes('MANDATORY') ? '600' : '400'
                                }}>
                                    • {precaution}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Quick Actions */}
                <div style={{
                    padding: '12px',
                    background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.8rem',
                    color: '#64748b',
                    textAlign: 'center',
                    lineHeight: '1.5'
                }}>
                    For urgent medical concerns, use the emergency communication panel below
                </div>
            </div>
        </Card>
    );
};

export default AISuggestionsWidget;
