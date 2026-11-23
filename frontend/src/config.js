// Central place for backend / engine URLs.
// Set VITE_API_URL (and optionally VITE_ENGINE_URL) in frontend/.env, then restart `npm run dev`.
const clean = (u) => String(u).replace(/\/+$/, '');

export const API_URL = clean(import.meta.env.VITE_API_URL || 'https://astrohealth-production-1ebf5e79.up.railway.app');
export const ENGINE_URL = clean(import.meta.env.VITE_ENGINE_URL || 'https://engine-production-ec9fea5d.up.railway.app');

// Optional realistic astronaut model for the hologram, e.g. VITE_ASTRONAUT_MODEL_URL=/models/astronaut.glb
// (put the file in frontend/public/models/). Empty = use the built-in 3D astronaut.
export const ASTRONAUT_MODEL_URL = String(import.meta.env.VITE_ASTRONAUT_MODEL_URL || '');
