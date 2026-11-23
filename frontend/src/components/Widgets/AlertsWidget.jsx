import React from 'react';
import Card from '../Common/Card';
import { humanize, formatTimestamp } from '../../utils/doctorNotifications';
import './AlertsWidget.css';

const ACTIONS = {
    PENDING_MEDICAL_REVIEW: ['ACKNOWLEDGE', 'Acknowledge'],
    ACKNOWLEDGED: ['START_REVIEW', 'Start Review'],
    IN_REVIEW: ['COMPLETE_REVIEW', 'Complete Review']
};

const up = (v) => String(v ?? '').toUpperCase();

/* Tone of the whole incident card, driven only by data the API really returns. */
const incidentTone = (incident) => {
    const esc = incident.escalation || {};
    const escStatus = up(esc.status);
    const review = up(incident.status);
    if (escStatus === 'ACTIVE' && up(esc.stage) === 'ESCALATED') return 'critical';
    if (escStatus === 'COMPLETED' && review === 'PENDING_MEDICAL_REVIEW') return 'critical';
    if (escStatus === 'ACTIVE') return 'high';
    if (review === 'PENDING_MEDICAL_REVIEW') return 'high';
    return 'normal';
};

const EscalationStrip = ({ incident }) => {
    const esc = incident.escalation || {};
    const status = up(esc.status);
    if (!status) return null;

    const exhausted = status === 'COMPLETED' && up(incident.status) === 'PENDING_MEDICAL_REVIEW';
    const live = status === 'ACTIVE' || exhausted;
    const label = exhausted
        ? 'WF05 escalation window elapsed'
        : status === 'ACTIVE'
            ? 'WF05 escalation active'
            : status === 'CANCELLED'
                ? 'WF05 escalation cancelled (acknowledged)'
                : 'WF05 escalation finished';

    return (
        <div className={`aw-escalation${live ? ' is-live' : ''}${exhausted || up(esc.stage) === 'ESCALATED' && live ? ' is-critical' : ''}`}>
            <span className="aw-escalation-label">{label}</span>
            <span className="aw-escalation-facts">
                <span><em>Stage</em>{humanize(esc.stage) || '—'}</span>
                <span><em>Status</em>{humanize(esc.status)}</span>
                <span><em>Reminders</em>{Number(esc.reminder_count) || 0}</span>
            </span>
        </div>
    );
};

const TriageBlock = ({ triage }) => {
    const brief = triage?.brief;
    return (
        <div className="aw-triage">
            <strong>AI Triage · {triage?.status || 'NOT_CREATED'}</strong>

            {brief ? (
                <>
                    <p>{brief.summary || 'No summary available.'}</p>

                    <div className="aw-confidence">
                        Confidence: {Math.round((Number(brief.confidence) || 0) * 100)}%
                    </div>

                    {Array.isArray(brief.findings) && brief.findings.length > 0 && (
                        <div className="aw-list-block">
                            <strong>Findings</strong>
                            <ul>
                                {brief.findings.slice(0, 4).map((item, i) => (
                                    <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {Array.isArray(brief.suggested_checks) && brief.suggested_checks.length > 0 && (
                        <div className="aw-list-block">
                            <strong>Suggested Checks</strong>
                            <ul>
                                {brief.suggested_checks.slice(0, 4).map((item, i) => (
                                    <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <small>AI-generated information for human medical review — not a diagnosis.</small>
                </>
            ) : (
                <p className="aw-muted">Triage details are not available yet.</p>
            )}
        </div>
    );
};

const AlertsWidget = ({ incidents = [], onAction, style, highlightedId = null }) => {
    const escalated = incidents.filter((i) => ['ACTIVE'].includes(up(i.escalation?.status))).length;
    const pending = incidents.filter((i) => up(i.status) === 'PENDING_MEDICAL_REVIEW').length;

    return (
        <Card title="Medical Incidents" style={style}>
            {incidents.length > 0 && (
                <div className="aw-summary">
                    <span className="aw-summary-item"><b>{incidents.length}</b> incidents</span>
                    <span className={`aw-summary-item${pending ? ' is-high' : ''}`}><b>{pending}</b> awaiting review</span>
                    <span className={`aw-summary-item${escalated ? ' is-critical' : ''}`}><b>{escalated}</b> active escalation{escalated === 1 ? '' : 's'}</span>
                </div>
            )}

            <div className="aw-scroll">
                {incidents.length === 0 ? (
                    <div className="aw-empty">No medical incidents</div>
                ) : incidents.map((incident, index) => {
                    const action = ACTIONS[incident.status];
                    const engineStatus = incident.engine_status || 'UNKNOWN';
                    const tone = incidentTone(incident);
                    const focused = highlightedId && highlightedId === incident.incident_id;

                    return (
                        <article
                            key={incident.incident_id || incident.event_id || index}
                            id={incident.incident_id ? `incident-${incident.incident_id}` : undefined}
                            data-incident-id={incident.incident_id}
                            className={`aw-incident is-${tone}${focused ? ' is-focused' : ''}`}
                        >
                            <div className="aw-head">
                                <strong className="aw-id">{incident.incident_id}</strong>
                                <span className={`aw-sev aw-sev-${up(incident.severity).toLowerCase()}`}>{incident.severity || 'UNKNOWN'}</span>
                            </div>

                            <div className="aw-meta">
                                <div><em>Astronaut</em><span>{incident.astronaut_id}</span></div>
                                <div><em>Engine Event Status</em><strong>{engineStatus}</strong></div>
                                <div><em>Medical Review Status</em><strong>{incident.status || 'UNKNOWN'}</strong></div>
                            </div>

                            <EscalationStrip incident={incident} />

                            <TriageBlock triage={incident.triage} />

                            <div className="aw-time">
                                {incident.created_at ? new Date(incident.created_at).toLocaleString() : 'Time unavailable'}
                                {incident.updated_at && incident.updated_at !== incident.created_at && (
                                    <span> · updated {formatTimestamp(incident.updated_at)}</span>
                                )}
                            </div>

                            {action && (
                                <button
                                    className="btn btn-danger aw-action"
                                    onClick={() => onAction(incident, action[0])}
                                >
                                    {action[1]}
                                </button>
                            )}
                        </article>
                    );
                })}
            </div>
        </Card>
    );
};

export default AlertsWidget;
