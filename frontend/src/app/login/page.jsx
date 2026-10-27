'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import AuthShell from '@/components/auth/AuthShell';
import GoogleButton from '@/components/auth/GoogleButton';
import PasswordInput from '@/components/auth/PasswordInput';
import OrDivider from '@/components/auth/OrDivider';
import { useAuthConfig } from '@/lib/authConfig';
import { USE_MOCK } from '@/services/api';

export default function LoginPage() {
  const { user, ready, login, loginWithGoogle } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const cfg = useAuthConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const showGoogle = Boolean(cfg.googleClientId) || USE_MOCK;

  useEffect(() => {
    if (ready && user) router.replace('/dashboard');
  }, [ready, user, router]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password, remember);
      router.replace('/dashboard');
    } catch (err) {
      setError(t(err.message || 'Gagal masuk'));
    } finally {
      setBusy(false);
    }
  }

  const onGoogle = useCallback(async (credential) => {
    setError('');
    setBusy(true);
    try {
      await loginWithGoogle(credential);
      router.replace('/dashboard');
    } catch (err) {
      setError(t(err.message || 'Gagal masuk'));
    } finally {
      setBusy(false);
    }
  }, [loginWithGoogle, router, t]);
  const onGoogleError = useCallback((m) => setError(t(m)), [t]);

  return (
    <AuthShell title="Selamat datang kembali" subtitle="Masuk untuk memantau chamber Anda.">
      {showGoogle && (
        <div className="mt-6">
          <GoogleButton clientId={cfg.googleClientId} onCredential={onGoogle} onError={onGoogleError} disabled={busy} />
          <OrDivider />
        </div>
      )}

      <form onSubmit={onSubmit} className={`${showGoogle ? '' : 'mt-6'} space-y-4`}>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" required autoComplete="email" className="input" placeholder={t('nama@email.com')}
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="label">{t('Kata Sandi')}</label>
          <PasswordInput id="password" placeholder={t('Masukkan kata sandi')} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-600 focus:ring-brand-600" />
          {t('Ingat saya')}
        </label>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-600/15">{error}</p>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full !py-3">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t('Masuk')}
        </button>
      </form>

      {cfg.allowRegistration && (
        <p className="mt-5 text-center text-sm text-slate-600">
          {t('Belum punya akun?')}{' '}
          <Link href="/register" className="font-semibold text-brand-700 hover:text-brand-800 hover:underline">{t('Daftar sekarang')}</Link>
        </p>
      )}

      {process.env.NODE_ENV !== 'production' && (
        <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
          {t('Akun demo')}: <b>admin@tofu.local</b> / <b>admin123</b>
          {USE_MOCK ? ` ${t('(mode demo tanpa backend)')}` : ''}
        </p>
      )}
    </AuthShell>
  );
}
