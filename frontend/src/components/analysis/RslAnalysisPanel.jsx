'use client';

import { Activity, AlertTriangle, BookOpenCheck } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { cn } from '@/lib/utils';

const fmt = (v, d = 2) =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function RslAnalysisPanel({ rsl }) {
  const { t } = useI18n();
  if (!rsl) return null;

  const m2 = rsl.supporting?.M2;
  const m3 = rsl.supporting?.M3;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-slate-900">
              <Activity className="h-4 w-4 text-teal-600" /> M2 · Turnbull NPMLE
            </h3>
            <p className="mt-1 text-xs text-slate-500">{t('Support sisa umur bersyarat; bukan interval kepercayaan.')}</p>
          </div>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset', m2?.status === 'OK' ? 'bg-teal-50 text-teal-700 ring-teal-600/20' : 'bg-slate-100 text-slate-600 ring-slate-500/20')}>
            {m2?.status || 'NOT_AVAILABLE'}
          </span>
        </div>
        {m2?.components?.length ? (
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {m2.components.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <span className="tabular-nums">{fmt(c.lowerHours)}–{fmt(c.upperHours)} {t('jam')}</span>
                <span className="text-xs text-slate-500">{t('massa')} {fmt(c.mass, 4)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">{t('Support tidak tersedia pada waktu ini.')}</p>
        )}
        <p className="mt-3 text-[11px] leading-snug text-slate-500">
          {m2?.note || t('Massa NPMLE hanya teridentifikasi pada irisan maksimal; lokasi waktu peristiwa di dalam support tidak teridentifikasi.')}
        </p>
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-slate-900">
              <BookOpenCheck className="h-4 w-4 text-indigo-600" /> M3 · Weibull A0
            </h3>
            <p className="mt-1 text-xs text-slate-500">{t('Komparator parametrik eksploratif; bukan model tervalidasi.')}</p>
          </div>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset', m3?.available ? 'bg-indigo-50 text-indigo-700 ring-indigo-600/20' : 'bg-slate-100 text-slate-600 ring-slate-500/20')}>
            {m3?.available ? 'AVAILABLE' : m3?.status || 'NOT_AVAILABLE'}
          </span>
        </div>
        {m3?.available ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-[11px] text-slate-500">r10</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{fmt(m3.r10Hours)} {t('jam')}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-[11px] text-slate-500">r90</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{fmt(m3.r90Hours)} {t('jam')}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-[11px] text-slate-500">shape</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{fmt(m3.shape, 4)}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-[11px] text-slate-500">scale</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{fmt(m3.scale, 4)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-500">{t('Komparator tidak tersedia pada waktu ini.')}</p>
        )}
        {m3?.supportWarning === 'EXCEEDS_EMPIRICAL_SUPPORT' && (
          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('Kuantil melewati batas dukungan empiris; jangan dipakai sebagai headline.')}
          </p>
        )}
        <p className="mt-3 text-[11px] leading-snug text-slate-500">
          {t('Dengan hanya tiga endpoint kering, bentuk Weibull tidak stabil. Nilai ini hanya pembanding eksploratif.')}
        </p>
      </div>
    </div>
  );
}
