import React from 'react';
import Card from '../Common/Card';

const AlertsWidget = ({ incidents = [], onAction, style }) => {
    const actions = {
        PENDING_MEDICAL_REVIEW: ['ACKNOWLEDGE', 'Acknowledge'],
        ACKNOWLEDGED: ['START_REVIEW', 'Start Review'],
        IN_REVIEW: ['COMPLETE_REVIEW', 'Complete Review']
    };

    return (
        <Card title="Medical Incidents" style={style}>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {incidents.length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>
                        No medical incidents
                    </div>
                ) : incidents.map((incident, index) => {
                    const action = actions[incident.status];
                    const engineStatus = incident.engine_status || 'UNKNOWN';

                    return (
                        <div key={incident.incident_id || incident.event_id || index} style={{
                            background: 'var(--bg-secondary, #fee2e2)',
                            border: '1px solid var(--border-color, #ef4444)',
                            padding: '16px',
                            borderRadius: '12px',
                            marginBottom: '12px'
                        }}>
                            <strong>{incident.incident_id}</strong>
                            <div style={{ marginTop: '8px' }}>
                                Astronaut: {incident.astronaut_id}
                            </div>
                            <div>Severity: {incident.severity}</div>

                            <div style={{ marginTop: '8px' }}>
                                Engine Event Status:{' '}
                                <strong>{engineStatus}</strong>
                            </div>

                            <div>
                                Medical Review Status:{' '}
                                <strong>{incident.status || 'UNKNOWN'}</strong>
                            </div>

                            <div style={{
                                marginTop: '12px', padding: '12px',
                                borderRadius: '8px',
                                background: 'var(--bg-primary, #f8fafc)',
                                border: '1px solid var(--border-color, #cbd5e1)'
                            }}>
                                <strong>AI Triage · {incident.triage?.status || 'NOT_CREATED'}</strong>

                                {incident.triage?.brief ? (
                                    <>
                                        <p style={{ margin: '8px 0' }}>
                                            {incident.triage.brief.summary || 'No summary available.'}
                                        </p>

                                        <div style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                                            Confidence: {Math.round((Number(incident.triage.brief.confidence) || 0) * 100)}%
                                        </div>

                                        {Array.isArray(incident.triage.brief.findings) &&
                                            incident.triage.brief.findings.length > 0 && (
                                            <div style={{ marginTop: '8px' }}>
                                                <strong>Findings</strong>
                                                <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                                                    {incident.triage.brief.findings.slice(0, 4).map((item, i) => (
                                                        <li key={i} style={{ marginBottom: '4px' }}>
                                                            {typeof item === 'string' ? item : JSON.stringify(item)}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {Array.isArray(incident.triage.brief.suggested_checks) &&
                                            incident.triage.brief.suggested_checks.length > 0 && (
                                            <div style={{ marginTop: '8px' }}>
                                                <strong>Suggested Checks</strong>
                                                <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                                                    {incident.triage.brief.suggested_checks.slice(0, 4).map((item, i) => (
                                                        <li key={i} style={{ marginBottom: '4px' }}>
                                                            {typeof item === 'string' ? item : JSON.stringify(item)}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        <small style={{ display: 'block', marginTop: '8px', color: 'var(--text-secondary)' }}>
                                            AI-generated information for human medical review — not a diagnosis.
                                        </small>
                                    </>
                                ) : (
                                    <p style={{ margin: '8px 0', fontSize: '0.85rem' }}>
                                        Triage details are not available yet.
                                    </p>
                                )}
                            </div>

                            <div style={{ fontSize: '0.8rem', marginTop: '8px', color: 'var(--text-secondary)' }}>
                                {incident.created_at ? new Date(incident.created_at).toLocaleString() : 'Time unavailable'}
                            </div>

                            {action && (
                                <button
                                    className="btn btn-danger"
                                    style={{ marginTop: '12px', width: '100%' }}
                                    onClick={() => onAction(incident, action[0])}
                                >
                                    {action[1]}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </Card>
    );
};

export default AlertsWidget;
