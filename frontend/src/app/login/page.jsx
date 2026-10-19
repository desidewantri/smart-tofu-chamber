'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import LanguageSwitch from '@/components/common/LanguageSwitch';
import { LogoMark } from '@/components/common/Logo';
import { USE_MOCK } from '@/services/api';


/** Kartu pratinjau statis untuk panel kanan halaman masuk. */
function PreviewCard({ className = '', name, hours, minutes, status, tone, path }) {
  const { t } = useI18n();
  return (
    <div className={`absolute w-[400px] rounded-2xl border-2 p-4 shadow-2xl ${tone.bg} ${tone.border} ${className}`} aria-hidden="true">
      <div className="flex items-center justify-between text-slate-900">
        <span className="font-bold">{name}</span>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> {t('Terhubung')}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-4 py-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('Sisa Umur Tahu')}</p>
          <p className={`mt-0.5 flex items-baseline gap-1.5 text-4xl font-extrabold leading-none ${tone.text}`}>
            {hours}<span className="mr-1.5 text-sm font-semibold text-slate-500">{t('jam')}</span>
            {minutes}<span className="text-sm font-semibold text-slate-500">{t('menit')}</span>
          </p>
        </div>
        <span className={`rounded-full px-3.5 py-1.5 text-sm font-bold ${tone.text} ${tone.pill}`}>● {t(status)}</span>
      </div>
      <svg viewBox="0 0 360 60" className="mt-2 h-16 w-full" fill="none">
        <path d="M0 46H360" stroke="#f59e0b" strokeDasharray="5 5" opacity=".6" />
        <path d={path} stroke={tone.stroke} strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_1.15fr]">
      {/* Panel branding */}
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-emerald-400 lg:block">
        <div className="absolute left-[12%] top-[14%] max-w-lg text-white">
          <h1 className="text-4xl font-bold leading-tight">{t('Umur simpan tahu, terpantau setiap saat.')}</h1>
          <p className="mt-4 text-lg leading-relaxed text-white/85">
            {t('Sensor membaca kondisi chamber, aplikasi memperkirakan sisa umur tahu dan memberi tahu kapan waktu terbaik untuk menjual.')}
          </p>
        </div>
        <PreviewCard
          className="left-[8%] top-[40%] -rotate-3"
          name="Chamber 1"
          hours="6" minutes="38"
          status="Tidak Layak Jual"
          tone={{ text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', stroke: '#b91c1c', pill: 'bg-red-100/70' }}
          path="M0 8 C60 12 120 22 180 30 S300 46 360 50"
        />
        <PreviewCard
          className="left-[36%] top-[62%] rotate-2"
          name="Chamber 2"
          hours="13" minutes="38"
          status="Segera Jual"
          tone={{ text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', stroke: '#b45309', pill: 'bg-amber-100/70' }}
          path="M0 12 C60 14 120 18 180 26 S300 34 360 38"
        />
      </section>

      {/* Form */}
      <section className="relative flex items-center justify-center bg-white px-6 py-12 lg:order-first lg:px-16">
        <LanguageSwitch className="absolute right-5 top-5 z-10 lg:fixed lg:right-8" />
        <div className="absolute left-6 top-20 flex items-center gap-3 lg:left-16 lg:top-[70px]">
          <LogoMark className="h-11 w-11" />
          <span className="text-lg font-bold text-slate-900">Smart Tofu Chamber</span>
        </div>
        <div className="mt-24 w-full max-w-md lg:mt-16">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">{t('Selamat datang kembali')}</h2>
            <p className="mt-2 text-base text-slate-500">{t('Masuk untuk memantau chamber Anda.')}</p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="label">Email</label>
                <input id="email" type="email" required autoComplete="email" className="input" placeholder={t('nama@email.com')}
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label htmlFor="password" className="label">{t('Kata Sandi')}</label>
                <div className="relative">
                  <input id="password" type={show ? 'text' : 'password'} required autoComplete="current-password" className="input pr-11"
                    placeholder={t('Masukkan kata sandi')} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('Sembunyikan kata sandi') : t('Tampilkan kata sandi')}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
                {t('Ingat saya')}
              </label>

              {error && (
                <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-600/15">{error}</p>
              )}

              <button type="submit" disabled={busy} className="btn-primary w-full !py-3">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t('Masuk')}
              </button>
            </form>

            {process.env.NODE_ENV !== 'production' && (
              <p className="mt-5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
                {t('Akun demo')}: <b>admin@tofu.local</b> / <b>admin123</b>
                {USE_MOCK ? ` ${t('(mode demo tanpa backend)')}` : ''}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
