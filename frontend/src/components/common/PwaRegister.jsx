'use client';

import { useEffect } from 'react';

/**
 * Mendaftarkan service worker (PWA). Hanya aktif di build produksi (npm run build + npm start),
 * agar cache tidak mengganggu saat pengembangan (npm run dev).
 * Catatan: service worker hanya berjalan di HTTPS atau di localhost.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      // Mode pengembangan: hapus service worker & cache sisa build produksi sebelumnya,
      // agar browser tidak memakai kode lama (penyebab error "Hydration failed").
      navigator.serviceWorker.getRegistrations().then(async (regs) => {
        if (!regs.length) return;
        await Promise.all(regs.map((r) => r.unregister()));
        if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
        window.location.reload();
      });
      return;
    }
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
