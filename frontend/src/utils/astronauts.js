import astro from '../assets/astro.jpg';

export const astronauts = ['ASTRO_01', 'ASTRO_02', 'ASTRO_03', 'ASTRO_04'].map((id, index) => ({
    id,
    name: id.replace('_', ' '),
    role: 'Flight Crew',
    avatar: astro,
    bio: `Crew member ${index + 1} — health telemetry provided by the ASTROHEALTH Intelligence Engine.`
}));
