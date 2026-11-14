import React from 'react';
import Card from '../Common/Card';

const AstronautProfileCard = ({ astronaut }) => {
    if (!astronaut) return null;

    return (
        <Card title="Astronaut Profile">
            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <img src={astronaut.avatar} alt={astronaut.name}
                    style={{
                        width: 100, height: 100, borderRadius: 16,
                        border: '2px solid var(--accent-blue)',
                        background: 'rgba(59,130,246,.1)'
                    }} />
                <div style={{ flex: 1 }}>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.5rem' }}>{astronaut.name}</h2>
                    <div style={{ color: 'var(--accent-cyan)', fontWeight: 600, marginBottom: 12 }}>
                        {astronaut.role}
                    </div>
                    <div>
                        <div className="unit">ASTRONAUT ID</div>
                        <div style={{ fontWeight: 700 }}>{astronaut.id}</div>
                    </div>
                </div>
            </div>
            <div style={{
                marginTop: 20, padding: 16,
                background: 'rgba(255,255,255,.03)', borderRadius: 8
            }}>
                <div className="unit">MISSION PROFILE</div>
                <div style={{ fontSize: '.9rem', lineHeight: 1.5 }}>{astronaut.bio}</div>
            </div>
        </Card>
    );
};

export default AstronautProfileCard;
