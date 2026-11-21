// Central place for backend / engine URLs.
// Set VITE_API_URL (and optionally VITE_ENGINE_URL) in frontend/.env, then restart `npm run dev`.
const clean = (u) => String(u).replace(/\/+$/, '');

export const API_URL = clean(import.meta.env.VITE_API_URL || 'http://localhost:4000');
export const ENGINE_URL = clean(import.meta.env.VITE_ENGINE_URL || 'http://127.0.0.1:8000');
