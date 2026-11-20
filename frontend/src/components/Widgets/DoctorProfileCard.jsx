import React from 'react';
import Card from '../Common/Card';
import avatar from '../../assets/doctor.jpeg';
const DoctorProfileCard = () => {
    const doctor = {
        name: 'Dr. Dhushyanth C',
        role: 'Chief Medical Officer',
        id: 'MED-001',
        specialization: 'Aerospace Medicine',
        status: 'On Duty',
        shift: 'Sigma',
        avatar: avatar
    };

    return (
        <Card title="Medical Officer">
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <img
                    src={doctor.avatar}
                    alt={doctor.name}
                    style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '50%',
                        border: '2px solid var(--accent-blue)',
                        background: 'rgba(59, 130, 246, 0.1)'
                    }}
                />
                <div style={{ flex: 1 }}>
                    <h2 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', color: 'var(--text-primary)' }}>{doctor.name}</h2>
                    <div style={{ color: 'var(--accent-blue)', fontWeight: '600', fontSize: '0.9rem' }}>{doctor.role}</div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <span className="status-badge status-normal">{doctor.status}</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>Shift: {doctor.shift}</span>
                    </div>
                </div>
            </div>

            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID</div>
                        <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{doctor.id}</div>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Specialization</div>
                        <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{doctor.specialization}</div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default DoctorProfileCard;
