'use client';

import { useI18n } from '@/context/I18nContext';
import LanguageSwitch from '@/components/common/LanguageSwitch';
import { LogoMark } from '@/components/common/Logo';

/** Kartu pratinjau statis untuk panel kanan halaman masuk. */
function PreviewCard({ className = '', name, hours, status, tone, path }) {
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
          <p className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wider text-slate-500">{t('Perkiraan Sisa Umur Tahu')}</p>
          <p className={`mt-0.5 flex items-baseline gap-1.5 text-4xl font-extrabold leading-none ${tone.text}`}>
            ±{hours}<span className="text-sm font-semibold text-slate-500">{t('jam lagi')}</span>
          </p>
        </div>
        <span className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold ${tone.text} ${tone.pill}`}>● {t(status)}</span>
      </div>
      <svg viewBox="0 0 360 60" className="mt-2 h-16 w-full" fill="none">
        <path d="M0 46H360" stroke="#f59e0b" strokeDasharray="5 5" opacity=".6" />
        <path d={path} stroke={tone.stroke} strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Kerangka halaman Masuk/Daftar: formulir di kiri, panel branding di kanan. */
export default function AuthShell({ title, subtitle, children }) {
  const { t } = useI18n();
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_1.15fr]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-cyan-400 lg:block">
        <div className="absolute left-[12%] top-[14%] max-w-lg text-white [@media(max-height:720px)]:top-[8%]">
          <h1 className="text-4xl font-bold leading-tight [@media(max-height:720px)]:text-3xl">{t('Umur simpan tahu, terpantau setiap saat.')}</h1>
          <p className="mt-4 text-lg leading-relaxed text-white/85">
            {t('Sensor membaca kondisi chamber, aplikasi memperkirakan sisa umur tahu dan memberi tahu kapan tahu sebaiknya dikonsumsi.')}
          </p>
        </div>
        <PreviewCard
          className="left-[8%] top-[40%] -rotate-3"
          name="Chamber 1"
          hours="6"
          status="Tidak Layak Konsumsi"
          tone={{ text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', stroke: '#b91c1c', pill: 'bg-red-100/70' }}
          path="M0 8 C60 12 120 22 180 30 S300 46 360 50"
        />
        <PreviewCard
          className="left-[36%] top-[62%] rotate-2"
          name="Chamber 2"
          hours="13"
          status="Segera Konsumsi"
          tone={{ text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', stroke: '#b45309', pill: 'bg-amber-100/70' }}
          path="M0 12 C60 14 120 18 180 26 S300 34 360 38"
        />
      </section>

      <section className="relative flex flex-col bg-white px-6 py-6 lg:order-first lg:px-16">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LogoMark className="h-11 w-11" />
            <span className="flex flex-col leading-tight">
              <span className="text-xl font-extrabold tracking-wide text-slate-900">TOSCHA</span>
              <span className="text-xs font-medium text-slate-500">Tofu Smart Chamber</span>
            </span>
          </div>
          <LanguageSwitch className="z-10" />
        </div>
        <div className="flex flex-1 items-center justify-center py-6">
          <div className="w-full max-w-md">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 [@media(max-height:760px)]:text-2xl">{t(title)}</h2>
            <p className="mt-2 text-base text-slate-500">{t(subtitle)}</p>
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}
