'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/context/I18nContext';
import { USE_MOCK } from '@/services/api';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiPromise = null;
function loadGsi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(window.google);
      s.onerror = () => {
        gsiPromise = null;
        reject(new Error('Gagal memuat layanan Google'));
      };
      document.head.appendChild(s);
    });
  }
  return gsiPromise;
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * Tombol "Masuk dengan Google".
 * - clientId ada  : memakai tombol resmi Google Identity Services, hasilnya ID token (credential).
 * - mode demo     : tombol tiruan agar alur bisa dicoba tanpa akun Google.
 * - selain itu    : tidak ditampilkan.
 */
export default function GoogleButton({ clientId, mode = 'signin', onCredential, onError, disabled }) {
  const { t, lang } = useI18n();
  const box = useRef(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [failed, setFailed] = useState(false);
  const label = mode === 'signup' ? 'Daftar dengan Google' : 'Masuk dengan Google';

  useEffect(() => {
    if (!clientId) return undefined;
    let alive = true;
    loadGsi()
      .then((google) => {
        if (!alive || !box.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (res) => res?.credential && cb.current?.(res.credential),
          ux_mode: 'popup',
          context: mode === 'signup' ? 'signup' : 'signin',
        });
        box.current.innerHTML = '';
        google.accounts.id.renderButton(box.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: mode === 'signup' ? 'signup_with' : 'signin_with',
          logo_alignment: 'center',
          locale: lang === 'en' ? 'en' : 'id',
          width: Math.min(box.current.offsetWidth || 400, 400),
        });
      })
      .catch((e) => {
        if (!alive) return;
        setFailed(true);
        onError?.(e.message);
      });
    return () => {
      alive = false;
    };
  }, [clientId, mode, lang, onError]);

  if (clientId) {
    return (
      <div>
        <div ref={box} className={`flex min-h-[44px] w-full justify-center ${disabled ? 'pointer-events-none opacity-60' : ''}`} />
        {failed && <p className="mt-2 text-center text-xs text-red-600">{t('Gagal memuat layanan Google')}</p>}
      </div>
    );
  }
  if (USE_MOCK) {
    return (
      <button type="button" disabled={disabled} onClick={() => onCredential?.('mock-google-credential')}
        className="btn-outline w-full !rounded-full !py-2.5">
        <GoogleG /> {t(label)}
      </button>
    );
  }
  return null;
}
