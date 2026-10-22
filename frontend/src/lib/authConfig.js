'use client';

import { useEffect, useState } from 'react';
import { api } from '@/services/api';

const FALLBACK = {
  allowRegistration: true,
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null,
};
let cache = null;

/** Pengaturan halaman masuk dari backend (pendaftaran dibuka? Client ID Google?). */
export function useAuthConfig() {
  const [cfg, setCfg] = useState(cache || FALLBACK);
  useEffect(() => {
    if (cache) return undefined;
    let alive = true;
    api
      .authConfig()
      .then((c) => {
        cache = { allowRegistration: c.allowRegistration !== false, googleClientId: c.googleClientId || FALLBACK.googleClientId };
        if (alive) setCfg(cache);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}
