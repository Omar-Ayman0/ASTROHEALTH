import React from 'react';
import Card from '../Common/Card';

import { generateSuggestions } from '../../utils/aiLogic';

const AISuggestionsWidget = ({ vitals, riskData, anomalyData }) => {
    if (!vitals || !riskData) return <Card title="AI Health Assistant">Loading...</Card>;

    const { suggestions, precautions } = generateSuggestions(vitals, riskData, anomalyData);

    const getRiskColor = () => {
        if (riskData.risk_label === 'Critical') return '#f87171';
        if (anomalyData?.is_anomaly) return '#fb923c';
        if (riskData.risk_label === 'High') return '#fb923c';
        return '#4ade80';
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
                    <div style={{ fontSize: '0.75rem', color: '#a9bdd3', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                        color: '#67e8f9',
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
                                background: 'linear-gradient(135deg, #0b2a4a 0%, #0a2440 100%)',
                                borderRadius: '8px',
                                border: '1px solid rgba(34, 211, 238, 0.32)',
                                color: '#e0f2fe',
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
                            color: '#67e8f9',
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
                                        ? 'linear-gradient(135deg, rgba(251, 191, 36, 0.18) 0%, rgba(251, 191, 36, 0.08) 100%)'
                                        : '#0a2440',
                                    borderRadius: '6px',
                                    border: precaution.includes('CRITICAL') || precaution.includes('IMPORTANT') || precaution.includes('MANDATORY')
                                        ? '1px solid rgba(251, 191, 36, 0.6)'
                                        : '1px solid rgba(34, 211, 238, 0.22)',
                                    color: precaution.includes('CRITICAL') || precaution.includes('IMPORTANT') || precaution.includes('MANDATORY')
                                        ? '#fde68a'
                                        : '#cbd5e1',
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
                    background: '#0a2440',
                    borderRadius: '8px',
                    border: '1px solid rgba(34, 211, 238, 0.22)',
                    fontSize: '0.8rem',
                    color: '#a9bdd3',
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
