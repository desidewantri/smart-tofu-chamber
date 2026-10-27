'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CloudRain, Sun } from 'lucide-react';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { TICK, TOOLTIP_STYLE, xAxisLabel, yAxisLabel } from '@/lib/chart';
import { formatMonth } from '@/lib/utils';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';

const SEASON = {
  hujan: { label: 'Musim Hujan (Okt–Mar)', icon: CloudRain, cls: 'bg-sky-50 text-sky-700' },
  kemarau: { label: 'Musim Kemarau (Apr–Sep)', icon: Sun, cls: 'bg-amber-50 text-amber-700' },
};

export default function SeasonalAnalysisTab({ chamberId, period }) {
  const { t } = useI18n();
  const { data, error, loading, reload } = usePolling(
    () => api.getSeasonal({ chamberId: chamberId ? chamberId : undefined, period }),
    0,
    [chamberId, period]
  );

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (data.months.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Belum ada data musiman" description="Dibutuhkan sesi pada beberapa bulan berbeda untuk melihat pola musiman." />
      </div>
    );
  }

  const rows = data.months.map((m) => ({ ...m, label: formatMonth(m.month) }));

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <h3 className="font-semibold text-slate-900">{t('Umur simpan awal dan suhu per bulan')}</h3>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          {t('Sumbu X: bulan. Batang (sumbu Y kiri): rata-rata perkiraan umur simpan saat tahu masuk (jam). Garis (sumbu Y kanan): rata-rata suhu awal (°C).')}
        </p>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 22, left: 4 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} label={xAxisLabel(t('Bulan'))} />
              <YAxis yAxisId="l" tick={TICK} axisLine={false} tickLine={false} width={56} label={yAxisLabel(t('Umur simpan awal (jam)'))} />
              <YAxis
                yAxisId="r"
                orientation="right"
                domain={['dataMin - 2', 'dataMax + 2']}
                tickFormatter={(v) => Math.round(v)}
                tick={TICK}
                axisLine={false}
                tickLine={false}
                width={56}
                label={yAxisLabel(t('Suhu awal (°C)'), 'right')}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" isAnimationActive={false} dataKey="avgShelfLife" name={t('Umur simpan awal (jam)')} fill="#16a34a" radius={[6, 6, 0, 0]} />
              <Line yAxisId="r" dataKey="avgSuhu" name={t('Suhu awal (°C)')} stroke="#ea580c" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {data.seasons.map((s) => {
          const meta = SEASON[s.season];
          return (
            <div key={s.season} className="card p-5">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${meta.cls}`}><meta.icon className="h-[18px] w-[18px]" /></span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t(meta.label)}</p>
                  <p className="text-xs text-slate-500">{t('{n} sesi', { n: s.sessions })}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">{t('Rata-rata suhu')}</dt><dd className="font-semibold">{s.avgSuhu ?? '—'} °C</dd></div>
                <div><dt className="text-slate-500">{t('Rata-rata kelembapan')}</dt><dd className="font-semibold">{s.avgRh ?? '—'} %</dd></div>
                <div><dt className="text-slate-500">{t('Rata-rata TVOC awal')}</dt><dd className="font-semibold">{s.avgTvoc ?? '—'} ppb</dd></div>
                <div><dt className="text-slate-500">{t('Umur simpan awal')}</dt><dd className="font-semibold">{s.avgShelfLife ?? '—'} {t('jam')}</dd></div>
              </dl>
            </div>
          );
        })}
      </div>

      <p className="rounded-2xl bg-slate-100 p-5 text-sm leading-relaxed text-slate-700">{t(data.insight)}</p>
    </div>
  );
}
