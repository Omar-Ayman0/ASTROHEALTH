import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './HomeSelection.css';

const ENGINE_URL = 'http://127.0.0.1:8000';

export default function HomeSelection() {
    const navigate = useNavigate();
    const { logout } = useAuth();

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/login', { replace: true });
        } catch (error) {
            console.error('Logout failed:', error);
        }
    };
    const [crew, setCrew] = useState([]);
    const [loading, setLoading] = useState(true);
    const [engineOnline, setEngineOnline] = useState(false);

    useEffect(() => {
        fetch(`${ENGINE_URL}/api/v1/astronauts`)
            .then(response => {
                if (!response.ok) throw new Error('Engine unavailable');
                return response.json();
            })
            .then(data => {
                setCrew(Array.isArray(data) ? data : data.astronauts || []);
                setEngineOnline(true);
            })
            .catch(error => {
                console.error('Crew loading failed:', error);
                setCrew(['ASTRO_01', 'ASTRO_02', 'ASTRO_03', 'ASTRO_04'].map(id => ({ astronaut_id: id })));
            })
            .finally(() => setLoading(false));
    }, []);

    const statusOf = member => member.status || 'DATA AVAILABLE';
    const idOf = member => member.astronaut_id || member.id;

    return (
        <main className="selection-page">
            <header className="selection-header">
                <div className="selection-brand">ASTRO<span>HEALTH</span></div>
                <div className="selection-header-actions">
                    <div className={`engine-indicator ${engineOnline ? 'online' : 'offline'}`}>
                        <span /> {engineOnline ? 'HEALTH ENGINE ONLINE' : 'HEALTH ENGINE CHECK'}
                    </div>
                    <button className="selection-logout" onClick={handleLogout} type="button">
                        <span>&gt;</span> SIGN OUT
                    </button>
                </div>
            </header>

            <section className="selection-hero">
                <div className="selection-eyebrow">MISSION CONTROL SYSTEM</div>
                <h1>Choose Your <span>Workspace</span></h1>
                <p>Select an astronaut profile to monitor health telemetry, or enter the medical officer dashboard.</p>
            </section>

            <section className="selection-grid">
                {['ASTRO_01', 'ASTRO_02', 'ASTRO_03', 'ASTRO_04'].map((id, index) => {
                    const member = crew.find(item => idOf(item) === id) || { astronaut_id: id };
                    return (
                        <button className="selection-card astronaut-card" key={id}
                            onClick={() => navigate(`/onboard/${id}`)}>
                            <div className="selection-icon astronaut-icon">{String(index + 1).padStart(2, '0')}</div>
                            <div className="selection-role">FLIGHT CREW</div>
                            <h2>{id.replace('_', ' ')}</h2>
                            <div className="selection-status">
                                <span className="selection-dot" />
                                {statusOf(member).replaceAll('_', ' ')}
                            </div>
                            <div className="selection-action">OPEN DASHBOARD <span>&gt;</span></div>
                        </button>
                    );
                })}

                <button className="selection-card doctor-card" onClick={() => navigate('/doctor')}>
                    <div className="selection-icon doctor-icon">+</div>
                    <div className="selection-role">MEDICAL TEAM</div>
                    <h2>Medical Officer</h2>
                    <div className="selection-status">Clinical Monitoring & Review</div>
                    <div className="selection-action">OPEN DASHBOARD <span>&gt;</span></div>
                </button>
            </section>

            {loading && <div className="selection-loading">Connecting to astronaut health systems...</div>}

            <footer className="selection-footer">
                ASTROHEALTH | SPACE CREW HEALTH MONITORING
            </footer>
        </main>
    );
}
