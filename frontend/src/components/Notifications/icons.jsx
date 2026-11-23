import React from 'react';

/*
 * Lucide icons (https://lucide.dev, ISC licence), inlined as a tiny component.
 * The project has no icon dependency and adding one would change package.json,
 * so the few glyphs the notification centre needs live here. Swapping to
 * `lucide-react` later only means replacing these exports.
 */
const Icon = ({ size = 18, strokeWidth = 2, className, children, ...rest }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        focusable="false"
        {...rest}
    >
        {children}
    </svg>
);

export const BellIcon = (p) => (
    <Icon {...p}>
        <path d="M10.268 21a2 2 0 0 0 3.464 0" />
        <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </Icon>
);

export const XIcon = (p) => (
    <Icon {...p}>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
    </Icon>
);

export const CheckCheckIcon = (p) => (
    <Icon {...p}>
        <path d="M18 6 7 17l-5-5" />
        <path d="m22 10-7.5 7.5L13 16" />
    </Icon>
);

export const ShieldCheckIcon = (p) => (
    <Icon {...p}>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
    </Icon>
);

export const TriangleAlertIcon = (p) => (
    <Icon {...p}>
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
    </Icon>
);

export const StethoscopeIcon = (p) => (
    <Icon {...p}>
        <path d="M11 2v2" />
        <path d="M5 2v2" />
        <path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />
        <path d="M8 15a6 6 0 0 0 12 0v-3" />
        <circle cx="20" cy="10" r="2" />
    </Icon>
);

export const ClockIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
    </Icon>
);

export const CircleCheckIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
    </Icon>
);

export const CircleXIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
    </Icon>
);

export const InfoIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
    </Icon>
);

export const RefreshIcon = (p) => (
    <Icon {...p}>
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
    </Icon>
);
