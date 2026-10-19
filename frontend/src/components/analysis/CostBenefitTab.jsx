'use client';

import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { TICK, TOOLTIP_STYLE, xAxisLabel, yAxisLabel } from '@/lib/chart';
import { cn, formatRupiah, STATUS_STYLES } from '@/lib/utils';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';

function Kpi({ label, value, hint, tone }) {
  const { t } = useI18n();
  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-slate-600">{t(label)}</p>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', tone || 'text-slate-900')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function CostBenefitTab({ chamberId, period }) {
  const { t } = useI18n();
  const { data, error, loading, reload } = usePolling(
    () => api.getCostBenefit({ chamberId: chamberId ? chamberId : undefined, period }),
    0,
    [chamberId, period]
  );

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (data.sessions === 0) {
    return (
      <div className="card">
        <EmptyState title="Belum ada sesi selesai" description="Analisis biaya dan manfaat dihitung dari sesi yang sudah ditutup pada periode ini." />
      </div>
    );
  }

  const counts = Object.entries(data.counts).map(([name, value]) => ({ name, value, fill: STATUS_STYLES[name].hex }));
  const money = [
    { name: 'Tanpa sistem', value: data.revenueWithoutSystem, fill: '#94a3b8' },
    { name: 'Dengan sistem', value: data.revenueWithSystem, fill: '#16a34a' },
  ];
  const positive = data.netBenefit >= 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Sesi selesai" value={data.sessions} hint={t('{n} kg tahu dipantau', { n: data.totalKg })} />
        <Kpi label="Pendapatan dengan sistem" value={formatRupiah(data.revenueWithSystem)} />
        <Kpi label="Pendapatan tanpa sistem" value={formatRupiah(data.revenueWithoutSystem)} hint={t('Berdasarkan asumsi tingkat tahu terbuang')} />
        <Kpi
          label="Manfaat bersih"
          value={formatRupiah(data.netBenefit)}
          hint={t('Setelah biaya operasional {v}', { v: formatRupiah(data.operationalCost) })}
          tone={positive ? 'text-emerald-700' : 'text-red-700'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h3 className="font-semibold text-slate-900">{t('Status akhir sesi')}</h3>
          <p className="mb-3 mt-1 text-xs text-slate-500">{t('Sumbu X: status akhir tahu saat dikeluarkan. Sumbu Y: jumlah sesi.')}</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={counts} margin={{ top: 8, right: 12, bottom: 22, left: 4 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={TICK} tickFormatter={(v) => t(v)} axisLine={false} tickLine={false} label={xAxisLabel(t('Status akhir tahu'))} />
                <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={56} label={yAxisLabel(t('Jumlah sesi (sesi)'))} />
                <Tooltip formatter={(v) => [`${v} ${t('sesi')}`, t('Jumlah sesi')]} labelFormatter={(v) => t(v)} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                  {counts.map((c) => <Cell key={c.name} fill={c.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card p-5 sm:p-6">
          <h3 className="font-semibold text-slate-900">{t('Pendapatan')}</h3>
          <p className="mb-3 mt-1 text-xs text-slate-500">{t('Sumbu X: skenario penjualan. Sumbu Y: perkiraan pendapatan (ribu rupiah).')}</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={money} margin={{ top: 8, right: 12, bottom: 22, left: 4 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={TICK} tickFormatter={(v) => t(v)} axisLine={false} tickLine={false} label={xAxisLabel(t('Skenario'))} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} width={62} tickFormatter={(v) => `${Math.round(v / 1000)}`} label={yAxisLabel(t('Pendapatan (ribu Rp)'))} />
                <Tooltip formatter={(v) => [formatRupiah(v), t('Pendapatan')]} labelFormatter={(v) => t(v)} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                  {money.map((c) => <Cell key={c.name} fill={c.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="rounded-2xl bg-amber-50 p-5 ring-1 ring-inset ring-amber-600/20">
        <h3 className="text-sm font-semibold text-amber-900">{t('Asumsi perhitungan')}</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900/90">
          {data.assumptions.map((a) => <li key={a}>{t(a)}</li>)}
        </ul>
        <p className="mt-3 text-xs text-amber-900/80">
          {t('Angka ini perkiraan, bukan hasil audit. Sesuaikan harga, diskon, dan tingkat tahu terbuang di')}{' '}
          <Link href="/settings" className="font-semibold underline">{t('Pengaturan → Batas Parameter')}</Link>.
        </p>
      </section>
    </div>
  );
}
