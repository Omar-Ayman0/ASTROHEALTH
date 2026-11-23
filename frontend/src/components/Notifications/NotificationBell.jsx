import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    CATEGORY,
    CATEGORY_LABEL,
    formatRelative,
    formatTimestamp,
    humanize
} from '../../utils/doctorNotifications';
import {
    BellIcon,
    CheckCheckIcon,
    CircleCheckIcon,
    CircleXIcon,
    ClockIcon,
    InfoIcon,
    RefreshIcon,
    ShieldCheckIcon,
    StethoscopeIcon,
    TriangleAlertIcon,
    XIcon
} from './icons';
import './NotificationBell.css';

const CATEGORY_ICON = {
    [CATEGORY.CRITICAL_ESCALATION]: TriangleAlertIcon,
    [CATEGORY.ESCALATION_REMINDER]: ClockIcon,
    [CATEGORY.MEDICAL_REVIEW]: StethoscopeIcon,
    [CATEGORY.TRIAGE_FAILED]: CircleXIcon,
    [CATEGORY.TRIAGE_COMPLETED]: CircleCheckIcon,
    [CATEGORY.GENERAL]: InfoIcon
};

// Order of the sections inside the dropdown.
const CATEGORY_ORDER = [
    CATEGORY.CRITICAL_ESCALATION,
    CATEGORY.ESCALATION_REMINDER,
    CATEGORY.MEDICAL_REVIEW,
    CATEGORY.TRIAGE_FAILED,
    CATEGORY.TRIAGE_COMPLETED,
    CATEGORY.GENERAL
];

const PANEL_WIDTH = 420;
const EDGE = 12;

const NotificationItem = ({ n, onSelect }) => {
    const Icon = CATEGORY_ICON[n.category] || InfoIcon;
    const hasEscalation = Boolean(n.escalationStatus);

    return (
        <li className="nb-li">
            <button
                type="button"
                className={`nb-item is-${n.priority}${n.read ? ' is-read' : ' is-unread'}`}
                onClick={() => onSelect(n)}
                aria-label={`${n.read ? '' : 'Unread. '}${CATEGORY_LABEL[n.category]}: incident ${n.incidentId}, ${n.astronautId}`}
            >
                <span className="nb-item-icon"><Icon size={16} /></span>

                <span className="nb-item-body">
                    <span className="nb-item-top">
                        <span className="nb-item-title">{n.title}</span>
                        {!n.read && <span className="nb-unread-dot" title="Unread" />}
                    </span>

                    <span className="nb-chips">
                        <span className="nb-chip nb-chip-strong">{n.incidentId}</span>
                        <span className="nb-chip">{n.astronautId}</span>
                        <span className={`nb-chip nb-sev nb-sev-${String(n.severity).toLowerCase()}`}>{n.severity}</span>
                    </span>

                    <span className="nb-item-summary">{n.summary}</span>

                    <span className="nb-facts">
                        {hasEscalation && (
                            <>
                                <span className="nb-fact"><em>Stage</em>{humanize(n.escalationStage) || '—'}</span>
                                <span className="nb-fact"><em>Reminders</em>{n.reminderCount ?? 0}</span>
                            </>
                        )}
                        <span className="nb-fact"><em>Triage</em>{humanize(n.triageStatus)}</span>
                        <span className="nb-fact"><em>Review</em>{humanize(n.reviewStatus)}</span>
                    </span>

                    <span className="nb-time">
                        {n.timestamp ? (
                            <span title={formatTimestamp(n.timestamp)}>
                                {n.timestampLabel}: {formatTimestamp(n.timestamp)}
                                <span className="nb-rel"> · {formatRelative(n.timestamp)}</span>
                            </span>
                        ) : (
                            <span>Time not provided by the server</span>
                        )}
                        {n.isEscalation && n.detectedAt && (
                            <span className="nb-detected" title="The server does not expose an escalation timestamp; this is when this state was first seen in this browser.">
                                Detected: {formatTimestamp(n.detectedAt)}
                            </span>
                        )}
                    </span>
                </span>
            </button>
        </li>
    );
};

/**
 * Notification bell for the dashboard header (rendered through DashboardLayout `topNavActions`).
 * The dropdown is portalled to <body>, positioned from the bell's rectangle, so no header /
 * card overflow, stacking context or backdrop-filter can clip or cover it.
 */
const NotificationBell = ({
    notifications = [],
    unreadCount = 0,
    unreadCritical = 0,
    alertTick = 0,
    loading = false,
    error = null,
    partialFailures = 0,
    lastUpdated = null,
    onSelect,
    onMarkAllRead,
    onRefresh
}) => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const buttonRef = useRef(null);
    const panelRef = useRef(null);

    const grouped = useMemo(() => CATEGORY_ORDER
        .map((category) => ({ category, items: notifications.filter((n) => n.category === category) }))
        .filter((g) => g.items.length > 0), [notifications]);

    const place = useCallback(() => {
        const btn = buttonRef.current;
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const top = Math.round(rect.bottom + 10);
        const narrow = vw <= PANEL_WIDTH + EDGE * 2;
        setPos({
            top,
            maxHeight: Math.max(240, Math.min(620, vh - top - EDGE)),
            ...(narrow
                ? { left: EDGE, right: EDGE }
                : { right: Math.max(EDGE, Math.round(vw - rect.right)), width: PANEL_WIDTH })
        });
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const onScroll = (e) => {
            // scrolling the notification list itself must not re-position the panel
            if (panelRef.current?.contains(e.target)) return;
            place();
        };
        window.addEventListener('resize', place);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [open, place]);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (e) => {
            if (panelRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                setOpen(false);
                buttonRef.current?.focus();
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const handleSelect = (n) => {
        setOpen(false);
        onSelect?.(n);
    };

    const badge = unreadCount > 99 ? '99+' : String(unreadCount);

    return (
        <div className="nb-root">
            <button
                ref={buttonRef}
                type="button"
                className={`nb-button${unreadCritical > 0 ? ' has-critical' : ''}${open ? ' is-open' : ''}`}
                aria-label={unreadCount > 0 ? `Medical notifications, ${unreadCount} unread` : 'Medical notifications'}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => {
                    if (!open) place();
                    setOpen((v) => !v);
                }}
            >
                {/* key={alertTick} re-mounts the icon so the ring animation replays on each new escalation */}
                <span key={alertTick} className={`nb-bell${alertTick > 0 ? ' nb-ring' : ''}`}>
                    <BellIcon size={20} />
                </span>
                {unreadCount > 0 && (
                    <span className="nb-badge" aria-hidden="true">{badge}</span>
                )}
            </button>

            {open && pos && createPortal(
                <div
                    ref={panelRef}
                    className="nb-panel"
                    role="dialog"
                    aria-label="Medical notifications"
                    style={pos}
                >
                    <header className="nb-head">
                        <div className="nb-head-title">
                            <BellIcon size={16} />
                            <span>MEDICAL NOTIFICATIONS</span>
                        </div>
                        <div className="nb-head-actions">
                            <button
                                type="button"
                                className="nb-icon-btn"
                                onClick={() => onRefresh?.()}
                                title="Refresh now"
                                aria-label="Refresh notifications"
                            >
                                <RefreshIcon size={15} />
                            </button>
                            <button
                                type="button"
                                className="nb-icon-btn"
                                onClick={() => setOpen(false)}
                                title="Close"
                                aria-label="Close notifications"
                            >
                                <XIcon size={16} />
                            </button>
                        </div>
                    </header>

                    <div className="nb-subhead">
                        <span className={`nb-unread-pill${unreadCount > 0 ? ' has-unread' : ''}`}>
                            {unreadCount} unread
                        </span>
                        <span className="nb-total">{notifications.length} total</span>
                        <button
                            type="button"
                            className="nb-markall"
                            onClick={() => onMarkAllRead?.()}
                            disabled={unreadCount === 0}
                        >
                            <CheckCheckIcon size={14} />
                            Mark all as read
                        </button>
                    </div>

                    {error && (
                        <div className="nb-banner" role="status">
                            <TriangleAlertIcon size={14} />
                            <span>
                                Refresh failed — showing the last successful update.
                                {typeof error === 'string' && error ? <small style={{ display: 'block', opacity: 0.8 }}>{error}</small> : null}
                            </span>
                        </div>
                    )}
                    {!error && partialFailures > 0 && (
                        <div className="nb-banner is-soft" role="status">
                            <InfoIcon size={14} />
                            Escalation status could not be read for {partialFailures} incident{partialFailures > 1 ? 's' : ''}; retrying.
                        </div>
                    )}

                    <div className="nb-scroll">
                        {loading && notifications.length === 0 ? (
                            <div className="nb-empty">
                                <span className="nb-empty-icon is-loading"><BellIcon size={26} /></span>
                                <strong>Loading notifications…</strong>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="nb-empty">
                                <span className="nb-empty-icon"><ShieldCheckIcon size={30} /></span>
                                <strong>All clear</strong>
                                <p>No active escalations or pending medical notifications.</p>
                            </div>
                        ) : grouped.map(({ category, items }) => {
                            const unread = items.filter((n) => !n.read).length;
                            return (
                                <section key={category} className="nb-group">
                                    <h4 className={`nb-group-title cat-${category.toLowerCase()}`}>
                                        <span>{CATEGORY_LABEL[category]}</span>
                                        <span className="nb-group-count">
                                            {unread > 0 ? `${unread} new · ` : ''}{items.length}
                                        </span>
                                    </h4>
                                    <ul className="nb-list">
                                        {items.map((n) => (
                                            <NotificationItem key={n.key} n={n} onSelect={handleSelect} />
                                        ))}
                                    </ul>
                                </section>
                            );
                        })}
                    </div>

                    <footer className="nb-foot">
                        {lastUpdated
                            ? `Updated ${new Date(lastUpdated).toLocaleTimeString()} · auto-refresh every 25 s`
                            : 'Waiting for first update…'}
                    </footer>
                </div>,
                document.body
            )}
        </div>
    );
};

export default NotificationBell;
