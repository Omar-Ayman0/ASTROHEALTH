import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DoctorProfileCard from '../Widgets/DoctorProfileCard';
import avatar from '../../assets/doctor.jpeg';

const DashboardLayout = ({ title, statusBadge, children, className = '' }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const isDoctor = location.pathname.includes('doctor');
    const [isProfileOpen, setIsProfileOpen] = useState(false);

    return (
        <div className="dashboard-layout">
            <nav className="top-nav">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-blue)' }}>
                        ASTRO<span style={{ color: 'var(--text-primary)' }}>HEALTH</span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <button className="btn" onClick={() => navigate('/')}
                        style={{ padding: '8px 16px', fontSize: '.85rem' }}>
                        ← Back to Selection
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-green)' }} />
                        <div style={{ fontSize: '.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            System Online
                        </div>
                    </div>

                    {isDoctor && (
                        <div style={{ position: 'relative' }}>
                            <div onClick={() => setIsProfileOpen(!isProfileOpen)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    paddingLeft: 16, borderLeft: '1px solid var(--border-color)',
                                    cursor: 'pointer', userSelect: 'none'
                                }}>
                                <img src={avatar} alt="Doctor"
                                    style={{ width: 32, height: 32, borderRadius: '50%' }} />
                                <div>
                                    <div style={{ fontSize: '.875rem', fontWeight: 700 }}>Dr. Dhushyanth C</div>
                                    <div style={{ fontSize: '.75rem', color: 'var(--text-secondary)' }}>Medical Officer</div>
                                </div>
                            </div>

                            {isProfileOpen && (
                                <div style={{
                                    position: 'absolute', top: '120%', right: 0,
                                    width: 350, maxWidth: '90vw', zIndex: 1000,
                                    filter: 'drop-shadow(0 10px 15px rgba(0,0,0,.1))'
                                }}>
                                    <DoctorProfileCard />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </nav>

            <main className={`main-content ${className}`}>
                <header style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', gap: 16, flexWrap: 'wrap',
                    marginBottom: 32
                }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800 }}>{title}</h1>
                        <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                            {new Date().toLocaleDateString(undefined, {
                                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                            })}
                        </div>
                    </div>
                    {statusBadge}
                </header>

                <div className="dashboard-grid">{children}</div>
            </main>
        </div>
    );
};

export default DashboardLayout;
