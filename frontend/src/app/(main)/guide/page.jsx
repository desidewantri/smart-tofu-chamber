'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Clock,
  Droplets,
  Gauge,
  History,
  Info,
  LayoutDashboard,
  Layers,
  LineChart,
  LogIn,
  LogOut,
  Palette,
  Ruler,
  Settings,
  Thermometer,
  Wind,
} from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { cn } from '@/lib/utils';
import { FAQ, STEPS, TOPICS } from '@/guide/content';

const ICONS = {
  login: LogIn,
  dashboard: LayoutDashboard,
  status: Palette,
  chamber: Boxes,
  close: LogOut,
  history: History,
  analysis: BarChart3,
  settings: Settings,
  tvoc: Wind,
  ppb: Ruler,
  temp: Thermometer,
  clock: Clock,
  session: Layers,
  zone: Gauge,
  chart: LineChart,
  limits: Info,
  humidity: Droplets,
};

function Tour() {
  const { t, lang } = useI18n();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const Icon = ICONS[step.icon] || BookOpen;
  const pct = ((i + 1) / STEPS.length) * 100;

  return (
    <section className="card overflow-hidden" aria-labelledby="tour-title">
      <div className="border-b border-slate-100 p-5 sm:p-6">
        <h2 id="tour-title" className="text-lg font-bold text-slate-900">{t('Panduan penggunaan langkah demi langkah')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('Ikuti urutan ini untuk mengenal aplikasi dari awal sampai bisa dipakai sehari-hari.')}</p>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={i + 1}>
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-semibold tabular-nums text-slate-500">{t('Langkah {n} dari {m}', { n: i + 1, m: STEPS.length })}</span>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[260px_1fr]">
        <ol className="thin-scroll flex gap-1 overflow-x-auto border-b border-slate-100 p-3 lg:flex-col lg:border-b-0 lg:border-r">
          {STEPS.map((s, idx) => (
            <li key={s.title.id} className="shrink-0">
              <button
                onClick={() => setI(idx)}
                aria-current={idx === i ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition',
                  idx === i ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    idx < i ? 'bg-brand-600 text-white' : idx === i ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'
                  )}
                >
                  {idx < i ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                </span>
                <span className="whitespace-nowrap lg:whitespace-normal">{s.title[lang]}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-4 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <Icon className="h-6 w-6" />
            </span>
            <div>
              <h3 className="text-xl font-bold text-slate-900">{step.title[lang]}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body[lang]}</p>
            </div>
          </div>

          {step.tips?.length > 0 && (
            <ul className="space-y-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              {step.tips.map((tip) => (
                <li key={tip.id} className="flex gap-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <span>{tip[lang]}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex gap-2">
              <button className="btn-outline" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}>
                <ArrowLeft className="h-4 w-4" /> {t('Sebelumnya')}
              </button>
              {i < STEPS.length - 1 ? (
                <button className="btn-primary" onClick={() => setI((v) => Math.min(STEPS.length - 1, v + 1))}>
                  {t('Berikutnya')} <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button className="btn-primary" onClick={() => setI(0)}>{t('Ulangi dari awal')}</button>
              )}
            </div>
            {step.href && (
              <Link href={step.href} className="text-sm font-semibold text-brand-700 hover:underline">
                {t('Buka halaman ini')} →
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Topic({ topic }) {
  const { lang } = useI18n();
  const Icon = ICONS[topic.icon] || BookOpen;
  return (
    <details className="card group overflow-hidden" open={topic.icon === 'tvoc'}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Icon className="h-5 w-5" />
        </span>
        <span className="flex-1 font-semibold text-slate-900">{topic.title[lang]}</span>
        <ChevronDown className="h-5 w-5 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-slate-100 p-4 text-sm leading-relaxed text-slate-600 sm:p-5">
        {topic.body.map((p) => (
          <p key={p.id}>{p[lang]}</p>
        ))}
      </div>
    </details>
  );
}

function Faq() {
  const { t, lang } = useI18n();
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-lg font-bold text-slate-900">{t('Pertanyaan yang sering muncul')}</h2>
      <dl className="mt-4 divide-y divide-slate-100">
        {FAQ.map((f) => (
          <div key={f.q.id} className="py-3">
            <dt className="text-sm font-semibold text-slate-900">{f.q[lang]}</dt>
            <dd className="mt-1 text-sm text-slate-600">{f.a[lang]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function GuidePage() {
  const { t } = useI18n();
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">{t('Panduan')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('Pelajari istilah di aplikasi ini, lalu ikuti panduan penggunaannya.')}</p>
      </div>

      <Tour />

      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">{t('Materi dasar')}</h2>
        <div className="grid gap-3">
          {TOPICS.map((topic) => (
            <Topic key={topic.title.id} topic={topic} />
          ))}
        </div>
      </section>

      <Faq />
    </div>
  );
}
