'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, Activity, ShieldCheck, Timer } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { LogoMark, TofuIllustration } from '@/components/common/Logo';
import { USE_MOCK } from '@/services/api';

export default function LoginPage() {
  const { user, ready, login } = useAuth();
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
      setError(err.message || 'Login gagal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Panel branding */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-emerald-500 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <LogoMark className="h-11 w-11" variant="light" />
          <span className="text-lg font-semibold">Smart Tofu Chamber</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Tahu segar, keputusan jual yang tepat waktu.</h1>
          <p className="mt-4 text-lg text-white/85">
            Sistem monitoring dan predictive analytics untuk estimasi shelf-life tahu.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/90">
            <li className="flex items-center gap-3"><Activity className="h-5 w-5" /> Pantau TVOC, suhu, dan kelembapan secara real-time</li>
            <li className="flex items-center gap-3"><Timer className="h-5 w-5" /> Hitung mundur sisa umur tahu per chamber</li>
            <li className="flex items-center gap-3"><ShieldCheck className="h-5 w-5" /> Status Layak Jual, Segera Jual, atau Tidak Layak Jual</li>
          </ul>
        </div>
        <TofuIllustration className="relative -mb-4 w-64 opacity-95" />
      </section>

      {/* Form */}
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark />
            <span className="text-lg font-semibold">Smart Tofu Chamber</span>
          </div>
          <div className="card p-8">
            <h2 className="text-2xl font-bold text-slate-900">Selamat Datang</h2>
            <p className="mt-1 text-sm text-slate-500">Masuk untuk memantau chamber Anda.</p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="label">Email</label>
                <input id="email" type="email" required autoComplete="email" className="input" placeholder="nama@email.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label htmlFor="password" className="label">Password</label>
                <div className="relative">
                  <input id="password" type={show ? 'text' : 'password'} required autoComplete="current-password" className="input pr-11"
                    placeholder="Masukkan password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
                Ingat saya
              </label>

              {error && (
                <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-600/15">{error}</p>
              )}

              <button type="submit" disabled={busy} className="btn-primary w-full !py-3">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Masuk
              </button>
            </form>

            {process.env.NODE_ENV !== 'production' && (
              <p className="mt-5 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
                Akun demo: <b>admin@tofu.local</b> / <b>admin123</b>
                {USE_MOCK ? ' (mode demo tanpa backend)' : ''}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
