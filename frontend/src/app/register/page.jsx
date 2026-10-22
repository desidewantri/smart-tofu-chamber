'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import AuthShell from '@/components/auth/AuthShell';
import GoogleButton from '@/components/auth/GoogleButton';
import PasswordInput from '@/components/auth/PasswordInput';
import OrDivider from '@/components/auth/OrDivider';
import { useAuthConfig } from '@/lib/authConfig';
import { USE_MOCK } from '@/services/api';

function Rule({ ok, children }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? 'text-emerald-600' : 'text-slate-400'}`}>
      <Check className="h-3.5 w-3.5" /> {children}
    </li>
  );
}

export default function RegisterPage() {
  const { user, ready, register, loginWithGoogle } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const cfg = useAuthConfig();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const showGoogle = Boolean(cfg.googleClientId) || USE_MOCK;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const longEnough = form.password.length >= 8;
  const mixed = /[A-Za-z]/.test(form.password) && /\d/.test(form.password);
  const same = form.password.length > 0 && form.password === form.confirm;

  useEffect(() => {
    if (ready && user) router.replace('/dashboard');
  }, [ready, user, router]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!longEnough || !mixed) return setError(t('Kata sandi minimal 8 karakter dan berisi huruf serta angka'));
    if (!same) return setError(t('Konfirmasi kata sandi tidak sama'));
    setBusy(true);
    try {
      await register({ name: form.name, email: form.email, password: form.password });
      router.replace('/dashboard');
    } catch (err) {
      setError(t(err.message || 'Gagal membuat akun'));
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
      setError(t(err.message || 'Gagal membuat akun'));
    } finally {
      setBusy(false);
    }
  }, [loginWithGoogle, router, t]);
  const onGoogleError = useCallback((m) => setError(t(m)), [t]);

  if (!cfg.allowRegistration) {
    return (
      <AuthShell title="Pendaftaran ditutup" subtitle="Pembuatan akun baru sedang tidak dibuka. Hubungi admin untuk mendapatkan akun.">
        <Link href="/login" className="btn-primary mt-6 w-full !py-3">{t('Kembali ke halaman masuk')}</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Buat akun baru" subtitle="Daftar untuk mulai memantau chamber tahu Anda.">
      {showGoogle && (
        <div className="mt-6">
          <GoogleButton mode="signup" clientId={cfg.googleClientId} onCredential={onGoogle} onError={onGoogleError} disabled={busy} />
          <OrDivider />
        </div>
      )}

      <form onSubmit={onSubmit} className={`${showGoogle ? '' : 'mt-6'} space-y-3.5`}>
        <div>
          <label htmlFor="name" className="label">{t('Nama lengkap')}</label>
          <input id="name" required minLength={2} maxLength={80} autoComplete="name" className="input" placeholder={t('Nama Anda')}
            value={form.name} onChange={set('name')} />
        </div>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" required autoComplete="email" className="input" placeholder={t('nama@email.com')}
            value={form.email} onChange={set('email')} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor="password" className="label">{t('Kata Sandi')}</label>
            <PasswordInput id="password" autoComplete="new-password" placeholder={t('Buat kata sandi')} value={form.password} onChange={set('password')} />
          </div>
          <div>
            <label htmlFor="confirm" className="label">{t('Ulangi kata sandi')}</label>
            <PasswordInput id="confirm" autoComplete="new-password" placeholder={t('Ketik ulang')} value={form.confirm} onChange={set('confirm')} />
          </div>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
          <Rule ok={longEnough}>{t('Minimal 8 karakter')}</Rule>
          <Rule ok={mixed}>{t('Huruf dan angka')}</Rule>
          <Rule ok={same}>{t('Kata sandi sama')}</Rule>
        </ul>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-600/15">{error}</p>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full !py-3">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t('Daftar')}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-600">
        {t('Sudah punya akun?')}{' '}
        <Link href="/login" className="font-semibold text-brand-700 hover:text-brand-800 hover:underline">{t('Masuk di sini')}</Link>
      </p>
    </AuthShell>
  );
}
