'use client';

import Link from 'next/link';
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { History } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { getLocale } from '@/lib/locale';
import { formatDateTime } from '@/lib/utils';
import { TICK, TOOLTIP_STYLE, xAxisLabel, yAxisLabel } from '@/lib/chart';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';
import RslStatusPill from './RslStatusPill';

const fmt = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

function m1Text(snapshot, t) {
  if (!snapshot.primary) return '—';
  const lower = snapshot.primary.display?.lowerHours ?? fmt(snapshot.primary.lowerHours, 0);
  const upper = snapshot.primary.display?.upperHours ?? fmt(snapshot.primary.upperHours, 0);
  return `${lower}–${upper} ${t('jam')}`;
}

function m2Text(m2, t) {
  if (m2?.components?.length) return t('{n} komponen', { n: m2.components.length });
  return m2?.status || '—';
}

function m3Text(m3) {
  if (!m3?.available) return m3?.status || '—';
  return `r10 ${fmt(m3.r10Hours)} j · r90 ${fmt(m3.r90Hours)} j`;
}

function SnapshotTooltip({ active, payload }) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-pop" style={TOOLTIP_STYLE}>
      <p className="font-semibold text-slate-900">{formatDateTime(point.snapshotAt)}</p>
      <p className="mt-1 text-slate-600">
        M1 {fmt(point.lowerHours)}–{fmt(point.upperHours)} {t('jam')}
      </p>
      <p className="text-[11px] text-slate-500">{point.referenceVersion || t('Versi referensi tidak tercatat')}</p>
    </div>
  );
}

function SnapshotChart({ snapshots }) {
  const { t } = useI18n();
  const data = snapshots
    .filter((snapshot) => snapshot.status === 'AVAILABLE' && snapshot.primary)
    .map((snapshot) => ({
      ts: new Date(snapshot.snapshotAt).getTime(),
      snapshotAt: snapshot.snapshotAt,
      lowerHours: snapshot.primary.lowerHours,
      upperHours: snapshot.primary.upperHours,
      referenceVersion: snapshot.metadata?.referenceVersion || null,
      label: snapshot.experimentLabel || snapshot.sesiCode || null,
    }));

  if (data.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200/70">
        {t('Belum ada snapshot M1 yang tersedia untuk digambarkan.')}
      </p>
    );
  }

  const times = data.map((point) => point.ts);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const pad = Math.max(3600000, (max - min) * 0.08);

  return (
    <div className="h-[250px] w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 18, bottom: 28, left: 4 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={[min - pad, max + pad]}
            tick={TICK}
            tickFormatter={(value) =>
              new Intl.DateTimeFormat(getLocale(), { day: '2-digit', month: 'short' }).format(
                new Date(value)
              )
            }
            axisLine={false}
            tickLine={false}
            label={xAxisLabel(t('Waktu snapshot'))}
          />
          <YAxis
            domain={[0, 'auto']}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={58}
            label={yAxisLabel(t('Jam'))}
          />
          <Tooltip content={<SnapshotTooltip />} />
          <Scatter
            name={t('Batas bawah M1')}
            data={data}
            dataKey="lowerHours"
            fill="#0f766e"
            isAnimationActive={false}
          />
          <Scatter
            name={t('Batas atas M1')}
            data={data}
            dataKey="upperHours"
            fill="#64748b"
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function RslSnapshotTimeline({ snapshots = [], loading = false, error = null, onRetry }) {
  const { t } = useI18n();

  if (loading && snapshots.length === 0) {
    return (
      <section className="card p-5 sm:p-6">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900">
          <History className="h-4 w-4 text-brand-700" /> {t('Riwayat snapshot RSL')}
        </h3>
        <Loading />
      </section>
    );
  }

  if (error) {
    return (
      <section className="card p-5 sm:p-6">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900">
          <History className="h-4 w-4 text-brand-700" /> {t('Riwayat snapshot RSL')}
        </h3>
        <div className="mt-3">
          <ErrorState error={error} onRetry={onRetry} />
        </div>
      </section>
    );
  }

  if (snapshots.length === 0) {
    return (
      <section className="card p-5 sm:p-6">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900">
          <History className="h-4 w-4 text-brand-700" /> {t('Riwayat snapshot RSL')}
        </h3>
        <EmptyState
          title="Belum ada snapshot RSL"
          description="Snapshot muncul setelah eksperimen dihentikan dan finalisasi selesai. Nilai live tidak disalin menjadi snapshot."
        />
      </section>
    );
  }

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-slate-900">
            <History className="h-4 w-4 text-brand-700" /> {t('Riwayat snapshot RSL')}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t('Snapshot akhir per eksperimen. Tidak dihitung ulang dari pengaturan model saat ini; setiap titik adalah hasil yang tersimpan.')}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-500/20">
          {t('Snapshot akhir')}
        </span>
      </div>

      <div className="mt-4">
        <SnapshotChart snapshots={snapshots} />
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#0f766e]" aria-hidden="true" /> {t('Batas bawah M1')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#64748b]" aria-hidden="true" /> {t('Batas atas M1')}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {t('Dua titik per snapshot adalah batas bawah dan batas atas M1. Tidak ada garis interpolasi; snapshot yang tidak tersedia tidak digambar.')}
        </p>
      </div>

      <div className="thin-scroll mt-4 hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[760px] text-left text-xs" aria-label={t('Snapshot RSL per chamber')}>
          <thead>
            <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2 font-semibold">{t('Snapshot')}</th>
              <th className="px-2 py-2 font-semibold">{t('Eksperimen')}</th>
              <th className="px-2 py-2 font-semibold">M1</th>
              <th className="px-2 py-2 font-semibold">M2</th>
              <th className="px-2 py-2 font-semibold">M3</th>
              <th className="px-2 py-2 font-semibold">{t('Status')}</th>
              <th className="px-2 py-2 font-semibold">{t('Referensi')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {snapshots.map((snapshot) => {
              const m2 = snapshot.supporting?.M2;
              const m3 = snapshot.supporting?.M3;
              return (
                <tr key={snapshot.id}>
                  <td className="px-2 py-3 align-top text-slate-700">{formatDateTime(snapshot.snapshotAt)}</td>
                  <td className="px-2 py-3 align-top">
                    <p className="font-semibold text-slate-900">{snapshot.experimentLabel || '—'}</p>
                    <p className="text-[11px] text-slate-500">{snapshot.sesiCode || '—'}</p>
                    {snapshot.sesiCode && (
                      <Link
                        href={`/history/${snapshot.sesiCode}`}
                        className="mt-0.5 inline-block text-[11px] font-semibold text-brand-700 hover:underline"
                      >
                        {t('Lihat sesi')}
                      </Link>
                    )}
                  </td>
                  <td className="px-2 py-3 align-top font-semibold tabular-nums text-slate-900">
                    {m1Text(snapshot, t)}
                  </td>
                  <td className="px-2 py-3 align-top text-slate-700">{m2Text(m2, t)}</td>
                  <td className="px-2 py-3 align-top text-slate-700">{m3Text(m3)}</td>
                  <td className="px-2 py-3 align-top">
                    <RslStatusPill status={snapshot.status} />
                  </td>
                  <td className="px-2 py-3 align-top text-slate-700">
                    {snapshot.metadata?.referenceVersion || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-3 lg:hidden">
        {snapshots.map((snapshot) => {
          const m2 = snapshot.supporting?.M2;
          const m3 = snapshot.supporting?.M3;
          return (
            <article key={snapshot.id} className="rounded-xl bg-slate-50/70 p-3 ring-1 ring-inset ring-slate-200/70">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">{formatDateTime(snapshot.snapshotAt)}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {snapshot.experimentLabel || '—'} · {snapshot.sesiCode || '—'}
                  </p>
                </div>
                <RslStatusPill status={snapshot.status} />
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <dt className="text-slate-500">M1</dt>
                <dd className="text-right font-semibold tabular-nums text-slate-900">{m1Text(snapshot, t)}</dd>
                <dt className="text-slate-500">M2</dt>
                <dd className="text-right text-slate-700">{m2Text(m2, t)}</dd>
                <dt className="text-slate-500">M3</dt>
                <dd className="text-right text-slate-700">{m3Text(m3)}</dd>
                <dt className="text-slate-500">{t('Referensi')}</dt>
                <dd className="text-right text-slate-700">{snapshot.metadata?.referenceVersion || '—'}</dd>
              </dl>
              {snapshot.sesiCode && (
                <Link
                  href={`/history/${snapshot.sesiCode}`}
                  className="mt-2 inline-block text-[11px] font-semibold text-brand-700 hover:underline"
                >
                  {t('Lihat sesi')}
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
