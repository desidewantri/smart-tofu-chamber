'use client';

import { useEffect } from 'react';

/**
 * Mendaftarkan service worker (PWA). Hanya aktif di build produksi (npm run build + npm start),
 * agar cache tidak mengganggu saat pengembangan (npm run dev).
 * Catatan: service worker hanya berjalan di HTTPS atau di localhost.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
