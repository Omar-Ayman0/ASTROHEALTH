import React from 'react';

const AIHealthReport = ({ report }) => {
    const needsReview = report.needs_human_review === true;
    const isHighRisk = ['HIGH', 'CRITICAL', 'HIGH_REVIEW_PRIORITY'].includes(
        String(report.severity || '').toUpperCase()
    );

    const statusColor = needsReview ? '#f87171' : '#4ade80';
    const formatLabel = (value) =>
        String(value || 'NOT AVAILABLE').replace(/_/g, ' ');

    const sectionStyle = {
        background: '#0a2440',
        border: '1px solid rgba(34, 211, 238, 0.26)',
        borderRadius: '10px',
        padding: '12px',
        marginTop: '12px'
    };

    const headingStyle = {
        fontSize: '12px',
        fontWeight: '800',
        color: '#67e8f9',
        textTransform: 'uppercase',
        letterSpacing: '0.6px',
        marginBottom: '9px'
    };

    const findings = Array.isArray(report.key_findings)
        ? report.key_findings : [];

    const focus = Array.isArray(report.review_focus)
        ? report.review_focus : [];

    const limitations = Array.isArray(report.limitations)
        ? report.limitations : [];

    const evidence = Array.isArray(report.evidence)
        ? report.evidence : [];

    return (
        <div style={{
            width: '100%',
            color: '#e0f2fe',
            fontSize: '13px',
            lineHeight: 1.6
        }}>

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px'
            }}>
                <span style={{
                    fontWeight: '800',
                    fontSize: '15px',
                    color: '#f0f9ff'
                }}>
                    AI HEALTH ASSESSMENT
                </span>

                <span style={{
                    background: 'rgba(34, 197, 94, 0.16)',
                    color: '#86efac',
                    padding: '4px 9px',
                    borderRadius: '20px',
                    fontSize: '10px',
                    fontWeight: '800'
                }}>
                    {formatLabel(report.status)}
                </span>
            </div>

            <div style={{
                ...sectionStyle,
                background: needsReview ? 'rgba(239, 68, 68, 0.12)' : 'rgba(34, 197, 94, 0.12)',
                border: `1px solid ${needsReview ? 'rgba(248, 113, 113, 0.55)' : 'rgba(74, 222, 128, 0.5)'}`
            }}>
                <div style={{
                    color: statusColor,
                    fontWeight: '900',
                    fontSize: '17px'
                }}>
                    {formatLabel(report.health_status)}
                </div>

                <div style={{
                    marginTop: '5px',
                    fontWeight: '700',
                    color: isHighRisk ? '#fca5a5' : '#cbd5e1'
                }}>
                    Priority: {formatLabel(report.severity)}
                </div>

                {needsReview && (
                    <div style={{
                        marginTop: '10px',
                        padding: '9px',
                        background: 'rgba(239, 68, 68, 0.22)',
                        borderRadius: '7px',
                        color: '#fecaca',
                        fontWeight: '800'
                    }}>
                        HUMAN MEDICAL REVIEW REQUIRED
                    </div>
                )}
            </div>

            <div style={sectionStyle}>
                <div style={headingStyle}>AI Summary</div>
                <div>{report.summary || 'No summary available.'}</div>
            </div>

            <div style={sectionStyle}>
                <div style={headingStyle}>
                    Key Findings ({findings.length})
                </div>

                {findings.length ? findings.map((item, index) => (
                    <div key={index} style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '6px 0',
                        borderBottom: index === findings.length - 1
                            ? 'none' : '1px solid rgba(34, 211, 238, 0.18)'
                    }}>
                        <span style={{ color: '#2dd4bf', fontWeight: '900' }}>
                            •
                        </span>
                        <span>{item}</span>
                    </div>
                )) : 'No findings available.'}
            </div>

            {focus.length > 0 && (
                <div style={sectionStyle}>
                    <div style={headingStyle}>Medical Review Focus</div>
                    {focus.map((item, index) => (
                        <div key={index} style={{ padding: '4px 0' }}>
                            • {item}
                        </div>
                    ))}
                </div>
            )}

            {evidence.length > 0 && (
                <div style={sectionStyle}>
                    <div style={headingStyle}>Evidence & Sources</div>

                    {evidence.map((item, index) => (
                        <div key={index} style={{
                            padding: '8px',
                            marginBottom: '7px',
                            background: '#071a30',
                            borderRadius: '7px',
                            border: '1px solid rgba(34, 211, 238, 0.22)'
                        }}>
                            <div style={{ fontWeight: '800' }}>
                                {formatLabel(item.source)}
                            </div>
                            <div style={{ fontSize: '11px', color: '#a9bdd3' }}>
                                Event: {item.event_id || 'N/A'}
                            </div>
                            <div style={{ fontSize: '11px', color: '#a9bdd3' }}>
                                Time: {item.timestamp || 'N/A'}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {limitations.length > 0 && (
                <div style={{
                    ...sectionStyle,
                    background: 'rgba(251, 191, 36, 0.1)',
                    borderColor: 'rgba(251, 191, 36, 0.5)'
                }}>
                    <div style={{ ...headingStyle, color: '#fcd34d' }}>
                        Limitations & Data Warnings
                    </div>

                    {limitations.map((item, index) => (
                        <div key={index} style={{
                            padding: '4px 0',
                            color: '#fde68a'
                        }}>
                            • {item}
                        </div>
                    ))}
                </div>
            )}

            <div style={{
                marginTop: '12px',
                paddingTop: '9px',
                borderTop: '1px solid rgba(34, 211, 238, 0.2)',
                fontSize: '10px',
                color: '#a9bdd3'
            }}>
                Astronaut: {report.astronaut_id || 'N/A'}
                {' | '}
                Generated: {report.generated_at
                    ? new Date(report.generated_at).toLocaleString()
                    : 'N/A'}
                <br />
                Research prototype — Not a medical device.
            </div>
        </div>
    );
};

export default AIHealthReport;
