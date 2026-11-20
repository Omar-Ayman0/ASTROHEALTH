import React from 'react';
import Card from '../Common/Card';
import { astronauts } from '../../utils/astronauts';

const AstronautListWidget = ({ selectedId, onSelect }) => {
    return (
        <Card title="Crew Roster" style={{ height: '100%', padding: '0' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                {astronauts.map(astro => (
                    <div
                        key={astro.id}
                        onClick={() => onSelect(astro.id)}
                        style={{
                            padding: '16px 24px',
                            borderBottom: '1px solid var(--border-color)',
                            cursor: 'pointer',
                            background: selectedId === astro.id ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                            borderLeft: selectedId === astro.id ? '4px solid var(--accent-blue)' : '4px solid transparent',
                            transition: 'all 0.2s'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <img
                                src={astro.avatar}
                                alt={astro.name}
                                style={{ width: '40px', height: '40px', borderRadius: '50%', border: '2px solid var(--border-color)' }}
                            />
                            <div>
                                <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{astro.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{astro.role}</div>
                            </div>
                            <div style={{ marginLeft: 'auto' }}>
                                <span className={`status-badge ${astro.status === 'Active' ? 'status-normal' : 'status-warning'}`}>
                                    {astro.status}
                                </span>
                            </div>
                        </div>
                    </div>
                ))
                }
            </div >
        </Card >
    );
};

export default AstronautListWidget;
