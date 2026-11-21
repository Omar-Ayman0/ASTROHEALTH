import React from 'react';

const AIHealthReport = ({ report }) => {
    const needsReview = report.needs_human_review === true;
    const isHighRisk = ['HIGH', 'CRITICAL', 'HIGH_REVIEW_PRIORITY'].includes(
        String(report.severity || '').toUpperCase()
    );

    const statusColor = needsReview ? '#dc2626' : '#059669';
    const formatLabel = (value) =>
        String(value || 'NOT AVAILABLE').replace(/_/g, ' ');

    const sectionStyle = {
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        padding: '12px',
        marginTop: '12px'
    };

    const headingStyle = {
        fontSize: '12px',
        fontWeight: '800',
        color: '#334155',
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
            color: '#1e293b',
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
                    color: '#0f172a'
                }}>
                    AI HEALTH ASSESSMENT
                </span>

                <span style={{
                    background: '#ecfdf5',
                    color: '#047857',
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
                background: needsReview ? '#fef2f2' : '#ecfdf5',
                border: `1px solid ${needsReview ? '#fecaca' : '#a7f3d0'}`
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
                    color: isHighRisk ? '#b91c1c' : '#475569'
                }}>
                    Priority: {formatLabel(report.severity)}
                </div>

                {needsReview && (
                    <div style={{
                        marginTop: '10px',
                        padding: '9px',
                        background: '#fee2e2',
                        borderRadius: '7px',
                        color: '#991b1b',
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
                            ? 'none' : '1px solid #e2e8f0'
                    }}>
                        <span style={{ color: '#0d9488', fontWeight: '900' }}>
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
                            background: '#ffffff',
                            borderRadius: '7px',
                            border: '1px solid #e2e8f0'
                        }}>
                            <div style={{ fontWeight: '800' }}>
                                {formatLabel(item.source)}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                                Event: {item.event_id || 'N/A'}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                                Time: {item.timestamp || 'N/A'}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {limitations.length > 0 && (
                <div style={{
                    ...sectionStyle,
                    background: '#fffbeb',
                    borderColor: '#fde68a'
                }}>
                    <div style={{ ...headingStyle, color: '#92400e' }}>
                        Limitations & Data Warnings
                    </div>

                    {limitations.map((item, index) => (
                        <div key={index} style={{
                            padding: '4px 0',
                            color: '#78350f'
                        }}>
                            • {item}
                        </div>
                    ))}
                </div>
            )}

            <div style={{
                marginTop: '12px',
                paddingTop: '9px',
                borderTop: '1px solid #e2e8f0',
                fontSize: '10px',
                color: '#94a3b8'
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
