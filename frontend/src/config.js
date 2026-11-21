// Central place for backend / engine URLs.
// Set VITE_API_URL (and optionally VITE_ENGINE_URL) in frontend/.env, then restart `npm run dev`.
const clean = (u) => String(u).replace(/\/+$/, '');

export const API_URL = clean(import.meta.env.VITE_API_URL || 'https://astrohealth-production-1ebf5e79.up.railway.app');
export const ENGINE_URL = clean(import.meta.env.VITE_ENGINE_URL || 'https://engine-production-ec9fea5d.up.railway.app');
