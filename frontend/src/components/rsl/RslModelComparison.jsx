'use client';

import { useI18n } from '@/context/I18nContext';
import { getLocale } from '@/lib/locale';
import { cn } from '@/lib/utils';
import RslStatusPill from './RslStatusPill';

const fmt = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const interval = (lower, upper, digits = 2) => `${fmt(lower, digits)}–${fmt(upper, digits)} j`;

function m1Output(primary, t) {
  if (!primary) return '—';
  const lower = primary.display?.lowerHours ?? Math.floor(Number(primary.lowerHours));
  const upper = primary.display?.upperHours ?? Math.ceil(Number(primary.upperHours));
  return `${lower}–${upper} ${t('jam')}`;
}

function m2Output(m2, t) {
  if (!m2 || !Array.isArray(m2.components) || m2.components.length === 0) {
    return '—';
  }
  return t('{n} komponen support', { n: m2.components.length });
}

function m3Output(m3, t) {
  if (!m3?.available) return '—';
  if (m3.suppressFromDashboard) return t('Disembunyikan dari ringkasan');
  return `r10 ${fmt(m3.r10Hours)} j · r90 ${fmt(m3.r90Hours)} j`;
}

function statusForM1(rsl) {
  if (rsl?.referenceOnly) return 'REFERENCE_ONLY';
  if (rsl?.primary) return 'AVAILABLE';
  return rsl?.status || 'UNAVAILABLE';
}

export default function RslModelComparison({ rsl, compact = false, className = '' }) {
  const { t } = useI18n();
  if (!rsl) return null;

  const primary = rsl.primary;
  const m2 = rsl.supporting?.M2;
  const m3 = rsl.supporting?.M3;
  const m1Status = statusForM1(rsl);
  const m2Status = m2?.status || 'NOT_AVAILABLE';
  const m3Status = m3?.available
    ? m3.suppressFromDashboard
      ? 'SUPPRESSED'
      : 'AVAILABLE'
    : m3?.status || 'NOT_AVAILABLE';

  const rows = [
    {
      key: 'M1',
      label: 'M1 · Empirical interval',
      role: rsl.referenceOnly ? t('Referensi') : t('Utama'),
      output: m1Output(primary, t),
      detail: primary
        ? `${t('Batas penuh')} ${interval(primary.lowerHours, primary.upperHours)} · ${t('{n} sesi referensi kering', { n: primary.nReferenceSessions ?? '—' })}`
        : rsl.message || t('Tidak ada angka pengganti yang dibuat.'),
      status: m1Status,
      primary: true,
    },
    {
      key: 'M2',
      label: 'M2 · Turnbull NPMLE',
      role: t('Pendukung'),
      output: m2Output(m2, t),
      detail:
        m2?.components?.length
          ? m2.components
              .map(
                (component) =>
                  `${interval(component.lowerHours, component.upperHours, 3)} (${t('massa')} ${fmt(component.mass, 3)})`
              )
              .join(' · ')
          : m2?.note || t('Tidak ada output dari engine.'),
      status: m2Status,
      primary: false,
    },
    {
      key: 'M3',
      label: 'M3 · Weibull A0',
      role: t('Pendukung'),
      output: m3Output(m3, t),
      detail: m3?.available
        ? `shape ${fmt(m3.shape, 4)} · scale ${fmt(m3.scale, 4)}${m3.supportWarning ? ` · ${m3.supportWarning}` : ''}`
        : m3?.note || t('Tidak ada output dari engine.'),
      status: m3Status,
      primary: false,
    },
  ];

  if (compact) {
    return (
      <div className={cn('rounded-xl bg-white/80 ring-1 ring-inset ring-slate-200/70', className)}>
        <ul className="divide-y divide-slate-100" aria-label={t('Perbandingan model RSL M1, M2, M3')}>
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className={cn('text-[11px] font-semibold', row.primary ? 'text-brand-800' : 'text-slate-600')}>
                {`${row.key} · ${row.role}`}
              </span>
              <span className="min-w-0 truncate text-right text-[11px] tabular-nums text-slate-700" title={row.detail}>
                {row.output}
              </span>
              <RslStatusPill status={row.status} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section className={cn('card p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">{t('Perbandingan model RSL')}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {t('M1 adalah hasil utama; M2 dan M3 adalah estimasi pendukung. Nilainya bukan kuantitas yang sama dan tidak digabung.')}
          </p>
        </div>
      </div>
      <div className="thin-scroll mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[620px] text-left text-xs" aria-label={t('Perbandingan model RSL M1, M2, M3')}>
          <thead>
            <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2 font-semibold">{t('Model')}</th>
              <th className="px-2 py-2 font-semibold">{t('Peran')}</th>
              <th className="px-2 py-2 font-semibold">{t('Keluaran')}</th>
              <th className="px-2 py-2 font-semibold">{t('Status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.key} className={row.primary ? 'bg-brand-50/40' : undefined}>
                <td className="px-2 py-3 align-top">
                  <p className="font-semibold text-slate-900">{row.label}</p>
                </td>
                <td className="px-2 py-3 align-top text-slate-600">{row.role}</td>
                <td className="px-2 py-3 align-top">
                  <p className="font-semibold tabular-nums text-slate-900">{row.output}</p>
                  <p className="mt-0.5 max-w-[280px] text-[11px] leading-snug text-slate-500">{row.detail}</p>
                </td>
                <td className="px-2 py-3 align-top">
                  <RslStatusPill status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 space-y-2 sm:hidden">
        {rows.map((row) => (
          <div
            key={row.key}
            className={cn(
              'rounded-xl p-3 ring-1 ring-inset',
              row.primary ? 'bg-brand-50/50 ring-brand-600/15' : 'bg-slate-50/70 ring-slate-200/70'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-900">{row.label}</p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{row.role}</p>
              </div>
              <RslStatusPill status={row.status} />
            </div>
            <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{row.output}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{row.detail}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-snug text-slate-500">
        {t('M1 adalah empirical interval envelope, bukan interval kepercayaan. M2 adalah support bersyarat; M3 adalah komparator parametrik. Tidak ada nilai yang diisi atau dirata-ratakan.')}
      </p>
    </section>
  );
}
