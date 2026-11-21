import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, getUserDestination } from '../context/AuthContext';
import './Login.css';

const AVAILABLE_ACCOUNTS = ['admin', 'doctor', 'astro01', 'astro02', 'astro03', 'astro04'];

function Icon({ name, size = 20 }) {
    const icons = {
        user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
        lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
        eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
        eyeOff: <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10 10 0 0 0 3.8-.7" /></>,
        shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
        arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
        globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
        help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.1 1-1.7 1.3-1.7 2.7M12 17h.01" /></>,
    };

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {icons[name]}
        </svg>
    );
}

function Brand() {
    return (
        <a className="astro-brand" href="/" aria-label="AstroHealth home">
            <span className="astro-brand-symbol">
                <span className="brand-orbit brand-orbit-one" />
                <span className="brand-orbit brand-orbit-two" />
                <span className="brand-core" />
            </span>
            <span className="brand-copy">
                <span className="brand-name">Astro<span>Health</span></span>
                <span className="brand-tagline">MISSION HEALTH SYSTEMS</span>
            </span>
        </a>
    );
}

function EarthVisual({ tilt }) {
    const style = {
        transform: `perspective(1200px) rotateX(${tilt.y * -8}deg) rotateY(${tilt.x * 10}deg) translateZ(18px)`
    };

    return (
        <div className="earth-visual holo-3d-stage" style={style} aria-hidden="true">
            <div className="earth-light earth-light-one" />
            <div className="earth-light earth-light-two" />

            <div
                className="earth-orbit earth-orbit-one"
                style={{ transform: `translate3d(${tilt.x * 12}px, ${tilt.y * 10}px, 28px)` }}
            >
                <span className="orbit-satellite satellite-one"><i /></span>
            </div>

            <div
                className="earth-orbit earth-orbit-two"
                style={{ transform: `translate3d(${tilt.x * -10}px, ${tilt.y * -8}px, 16px)` }}
            >
                <span className="orbit-satellite satellite-two"><i /></span>
            </div>

            <div
                className="earth-orbit earth-orbit-three"
                style={{ transform: `translate3d(${tilt.x * 6}px, ${tilt.y * 6}px, 8px)` }}
            />

            <div
                className="earth-planet holo-3d-core"
                style={{ transform: `translate3d(${tilt.x * 16}px, ${tilt.y * 14}px, 42px)` }}
            >
                <img
                    className="earth-photo"
                    src="/images/earth.webp"
                    alt=""
                    draggable="false"
                />
                <div className="earth-atmosphere" />
            </div>

            <span className="earth-star earth-star-one">✦</span>
            <span className="earth-star earth-star-two">+</span>
            <span className="earth-star earth-star-three">✧</span>
        </div>
    );
}

export default function Login() {
    const { user, loading: authLoading, login } = useAuth();
    const navigate = useNavigate();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [usernameError, setUsernameError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [generalError, setGeneralError] = useState('');
    const [helpMessage, setHelpMessage] = useState('');
    const [showUsernameOptions, setShowUsernameOptions] = useState(false);
    const [activeUsernameIndex, setActiveUsernameIndex] = useState(-1);
    const [tilt, setTilt] = useState({ x: 0, y: 0 });
    const usernameContainerRef = useRef(null);

    const filteredAccounts = AVAILABLE_ACCOUNTS.filter((account) =>
        account.toLowerCase().includes(username.trim().toLowerCase())
    );

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (usernameContainerRef.current && !usernameContainerRef.current.contains(event.target)) {
                setShowUsernameOptions(false);
                setActiveUsernameIndex(-1);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const handleMouseMove = (event) => {
        const { clientX, clientY, currentTarget } = event;
        const rect = currentTarget.getBoundingClientRect();
        const nx = ((clientX - rect.left) / rect.width - 0.5) * 2;
        const ny = ((clientY - rect.top) / rect.height - 0.5) * 2;
        setTilt({ x: nx, y: ny });
    };

    const handleMouseLeave = () => {
        setTilt({ x: 0, y: 0 });
    };

    const selectUsername = (account) => {
        setUsername(account);
        setShowUsernameOptions(false);
        setActiveUsernameIndex(-1);
        setUsernameError('');
        setGeneralError('');
        setHelpMessage('');
    };

    const handleUsernameKeyDown = (event) => {
        if (event.key === 'Escape') {
            setShowUsernameOptions(false);
            setActiveUsernameIndex(-1);
            return;
        }

        if (!showUsernameOptions || filteredAccounts.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveUsernameIndex((current) =>
                current >= filteredAccounts.length - 1 ? 0 : current + 1
            );
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveUsernameIndex((current) =>
                current <= 0 ? filteredAccounts.length - 1 : current - 1
            );
        } else if (event.key === 'Enter' && activeUsernameIndex >= 0) {
            event.preventDefault();
            selectUsername(filteredAccounts[activeUsernameIndex]);
        }
    };

    if (authLoading) {
        return (
            <div className="astro-loading-screen">
                <span className="loading-orbit" />
                <p>Preparing your mission workspace...</p>
            </div>
        );
    }

    if (user) {
        return <Navigate to={getUserDestination(user)} replace />;
    }

    const clearErrors = () => {
        setUsernameError('');
        setPasswordError('');
        setGeneralError('');
        setHelpMessage('');
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (submitting) return;

        clearErrors();

        let valid = true;

        if (!username.trim()) {
            setUsernameError('Please enter your username.');
            valid = false;
        }

        if (!password) {
            setPasswordError('Please enter your password.');
            valid = false;
        }

        if (!valid) return;

        setSubmitting(true);

        try {
            const authenticatedUser = await login(username.trim(), password);
            navigate(getUserDestination(authenticatedUser), { replace: true });
        } catch (err) {
            const message = err?.response?.data?.message || '';

            if (/username not found/i.test(message)) {
                setUsernameError('Username not found. Check your account and try again.');
            } else if (/incorrect password/i.test(message)) {
                setPasswordError('Incorrect password. Please try again.');
            } else {
                setGeneralError('Unable to sign in. Please check your connection and try again.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const card3DStyle = {
        transform: `perspective(1100px) rotateX(${tilt.y * -3.5}deg) rotateY(${tilt.x * 4.5}deg) translateZ(12px)`
    };

    return (
        <main
            className="astro-login-page"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            <div className="login-space-background" aria-hidden="true">
                <div className="space-stars stars-back" />
                <div className="space-stars stars-front" />
                <div className="space-nebula nebula-left" />
                <div className="space-nebula nebula-right" />
            </div>

            <header className="login-header">
                <Brand />

                <nav className="header-links" aria-label="Page links">
                    <a href="#access-help">
                        <Icon name="help" size={15} />
                        <span>Help & Support</span>
                    </a>
                    <span className="header-divider" />
                    <span className="language-indicator">
                        <Icon name="globe" size={15} />
                        EN
                    </span>
                </nav>
            </header>

            <div className="login-layout">
                <section className="hero-column" aria-labelledby="hero-title">
                    <div className="hero-content">
                        <div className="hero-eyebrow">
                            <span className="eyebrow-line" />
                            SPACE HEALTH INTELLIGENCE
                        </div>

                        <h1 id="hero-title">
                            Every heartbeat<br />
                            matters <span>everywhere.</span>
                        </h1>

                        <p className="hero-description">
                            Advanced astronaut health intelligence. One mission.
                            One team. One connected system.
                        </p>

                        <div className="hero-bottom">
                            <div className="hero-indicator">
                                <span className="indicator-dot" />
                                <span>YOUR HEALTH. OUR MISSION.</span>
                            </div>
                            <span className="hero-coordinate">EARTH ORBIT · 001</span>
                        </div>
                    </div>

                    <EarthVisual tilt={tilt} />
                </section>

                <section className="form-column" aria-label="Sign in">
                    <div className="login-card holo-3d-card" style={card3DStyle}>
                        <div className="card-top-accent" />

                        <div className="card-brand-icon">
                            <span className="mini-orbit mini-orbit-one" />
                            <span className="mini-orbit mini-orbit-two" />
                            <span className="mini-core" />
                        </div>

                        <div className="card-heading">
                            <h2>Welcome <span>aboard.</span></h2>
                            <p>Sign in to access your mission workspace.</p>
                        </div>

                        <form className="login-form" onSubmit={handleSubmit} noValidate>
                            <div className="form-field">
                                <label htmlFor="astro-username">Username</label>

                                <div className="username-autocomplete" ref={usernameContainerRef}>
                                    <div className={`input-shell ${usernameError ? 'input-error' : ''}`}>
                                        <span className="input-icon"><Icon name="user" /></span>
                                        <input
                                            id="astro-username"
                                            name="username"
                                            type="text"
                                            value={username}
                                            onFocus={() => setShowUsernameOptions(true)}
                                            onKeyDown={handleUsernameKeyDown}
                                            onChange={(e) => {
                                                setUsername(e.target.value);
                                                setUsernameError('');
                                                setGeneralError('');
                                                setHelpMessage('');
                                                setShowUsernameOptions(true);
                                                setActiveUsernameIndex(-1);
                                            }}
                                            placeholder="Enter your username"
                                            autoComplete="off"
                                            autoCapitalize="none"
                                            spellCheck="false"
                                            disabled={submitting}
                                            aria-invalid={Boolean(usernameError)}
                                            aria-autocomplete="list"
                                            aria-expanded={showUsernameOptions}
                                            aria-controls="username-options"
                                            aria-describedby={usernameError ? 'username-error' : undefined}
                                        />
                                    </div>

                                    {showUsernameOptions && !submitting && filteredAccounts.length > 0 && (
                                        <div className="username-options" id="username-options" role="listbox" aria-label="Available accounts">
                                            <div className="username-options-heading">AVAILABLE ACCOUNTS</div>
                                            {filteredAccounts.map((account, index) => (
                                                <button
                                                    key={account}
                                                    type="button"
                                                    className={`username-option ${activeUsernameIndex === index ? 'active' : ''}`}
                                                    role="option"
                                                    aria-selected={username === account}
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => selectUsername(account)}
                                                >
                                                    <span className="username-option-avatar">{account === 'admin' ? 'A' : account === 'doctor' ? 'D' : 'A'}</span>
                                                    <span className="username-option-name">{account}</span>
                                                    <span className="username-option-arrow">→</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {usernameError && (
                                    <p className="field-error-message" id="username-error" role="alert">
                                        {usernameError}
                                    </p>
                                )}
                            </div>

                            <div className="form-field password-group">
                                <div className="password-label-row">
                                    <label htmlFor="astro-password">Password</label>
                                    <button
                                        type="button"
                                        className="forgot-link"
                                        onClick={() => setHelpMessage('For password assistance, please contact your system administrator.')}
                                    >
                                        Forgot password?
                                    </button>
                                </div>

                                <div className={`input-shell ${passwordError ? 'input-error' : ''}`}>
                                    <span className="input-icon"><Icon name="lock" /></span>

                                    <input
                                        id="astro-password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.target.value);
                                            setPasswordError('');
                                            setGeneralError('');
                                            setHelpMessage('');
                                        }}
                                        placeholder="Enter your password"
                                        autoComplete="current-password"
                                        disabled={submitting}
                                        aria-invalid={Boolean(passwordError)}
                                        aria-describedby={passwordError ? 'password-error' : undefined}
                                    />

                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() => setShowPassword((value) => !value)}
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        aria-pressed={showPassword}
                                    >
                                        <Icon name={showPassword ? 'eyeOff' : 'eye'} size={19} />
                                    </button>
                                </div>

                                {passwordError && (
                                    <p className="field-error-message" id="password-error" role="alert">
                                        {passwordError}
                                    </p>
                                )}
                            </div>

                            {generalError && (
                                <div className="general-error" role="alert">
                                    {generalError}
                                </div>
                            )}

                            {helpMessage && (
                                <div className="help-feedback" role="status">
                                    {helpMessage}
                                </div>
                            )}

                            <button className="login-submit" type="submit" disabled={submitting}>
                                {submitting ? (
                                    <>
                                        <span className="button-spinner" />
                                        <span>Signing in...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Access Mission Control</span>
                                        <Icon name="arrow" size={19} />
                                    </>
                                )}
                            </button>
                        </form>

                        <div className="security-line">
                            <Icon name="shield" size={16} />
                            <span>Encrypted session <i /> Authorized personnel only</span>
                        </div>

                        <div className="card-help" id="access-help">
                            <p>Need access? <a href="mailto:">Contact your system administrator.</a></p>
                        </div>
                    </div>
                </section>
            </div>

            <footer className="login-footer">
                <span>© 2026 AstroHealth</span>
                <div>
                    <a href="#privacy
