import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import DoctorProfileCard from '../Widgets/DoctorProfileCard';
import avatar from '../../assets/doctor.jpeg';
import '../../pages/AstronautDashboard.css';
import './DashboardLayout.css';

const pad = (n) => String(n).padStart(2, '0');

const useNow = () => {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
};

const HeaderClock = () => {
    const now = useNow();
    return (
        <div className="dash-clock" title="Local date and time">
            <span className="dash-clock-date">
                {now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <span className="dash-clock-time">
                {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
            </span>
        </div>
    );
};

const FooterClock = () => {
    const now = useNow();
    return (
        <span className="dash-footer-utc">
            UTC {pad(now.getUTCHours())}:{pad(now.getUTCMinutes())}:{pad(now.getUTCSeconds())}
        </span>
    );
};

const BrandMark = () => (
    <svg className="dash-brand-mark" viewBox="0 0 40 40" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <ellipse cx="20" cy="20" rx="15" ry="6" transform="rotate(35 20 20)" />
            <ellipse cx="20" cy="20" rx="15" ry="6" transform="rotate(-35 20 20)" />
        </g>
        <circle cx="20" cy="20" r="3.4" fill="#f0f9ff" />
    </svg>
);

const DashboardLayout = ({ title, statusBadge, children, className = '', topNavActions }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const isDoctor = location.pathname.includes('doctor');
    const [isProfileOpen, setIsProfileOpen] = useState(false);

    const alertState = /critical-alert/.test(className) ? ' is-critical' : /high-risk-alert/.test(className) ? ' is-high-risk' : '';
    const subtitle = String(title || '').replace(/\s*\|\s*/g, ' // ');

    return (
        <div className={`dashboard-layout astro-shell astro-space-theme${isDoctor ? ' doctor-shell' : ''}${alertState}`}>
            <nav className="top-nav">
                <div className="top-nav-inner">
                    <div className="dash-brand">
                        <BrandMark />
                        <div className="dash-brand-text">
                            <div className="dash-brand-name">
                                ASTRO<span>HEALTH</span>
                            </div>
                            {subtitle && <div className="dash-brand-sub">{subtitle}</div>}
                        </div>
                    </div>

                    <div className="dash-nav-right">
                        <HeaderClock />

                        {statusBadge && <div className="dash-status">{statusBadge}</div>}

                        {topNavActions}

                        <button
                            className="btn dash-back-btn"
                            onClick={async () => {
                                if (user?.role === 'admin') {
                                    navigate('/', { replace: true });
                                    return;
                                }

                                try {
                                    await logout();
                                } catch (error) {
                                    console.error('Logout failed:', error);
                                } finally {
                                    navigate('/login', { replace: true });
                                }
                            }}
                        >
                            {user?.role === 'admin' ? 'Back to Astronaut Selection' : 'Back to Login'}
                        </button>

                        <div className="dash-online">
                            <span className="dash-online-dot" />
                            <span className="dash-online-text">System Online</span>
                        </div>

                        {isDoctor && (
                            <div style={{ position: 'relative' }}>
                                <div
                                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                                    className="dash-profile"
                                >
                                    <img src={avatar} alt="Doctor" />
                                    <div>
                                        <div className="dash-profile-name">Dr. Dhushyanth C</div>
                                        <div className="dash-profile-role">Medical Officer</div>
                                    </div>
                                </div>

                                {isProfileOpen && (
                                    <div style={{
                                        position: 'absolute', top: '120%', right: 0,
                                        width: 350, maxWidth: '90vw', zIndex: 1000,
                                        filter: 'drop-shadow(0 10px 15px rgba(0,0,0,.45))'
                                    }}>
                                        <DoctorProfileCard />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </nav>

            <main className={`main-content ${className}`}>
                <div className="dashboard-grid">{children}</div>
            </main>

            <footer className="dash-footer">
                <div className="dash-footer-inner">
                    <div className="dash-footer-left">
                        &copy; {new Date().getFullYear()} <strong>ASTROHEALTH</strong>
                        <span className="dash-footer-sep">&middot;</span>
                        <span className="dash-footer-tag">Orbital Crew Health Monitoring</span>
                    </div>
                    <div className="dash-footer-mid">NASA // MISSION TELEMETRY</div>
                    <div className="dash-footer-right">
                        <FooterClock />
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default DashboardLayout;
