'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CloudRain, Sun } from 'lucide-react';
import { api } from '@/services/api';
import { usePolling } from '@/lib/hooks';
import { formatMonth } from '@/lib/utils';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';

const SEASON = {
  hujan: { label: 'Musim Hujan (Okt–Mar)', icon: CloudRain, cls: 'bg-sky-50 text-sky-700' },
  kemarau: { label: 'Musim Kemarau (Apr–Sep)', icon: Sun, cls: 'bg-amber-50 text-amber-700' },
};

export default function SeasonalAnalysisTab({ chamberId, period }) {
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
        <h3 className="font-semibold text-slate-900">Shelf-life awal vs suhu per bulan</h3>
        <p className="mb-3 mt-1 text-xs text-slate-500">Batang: rata-rata estimasi shelf-life saat tahu masuk (jam). Garis: rata-rata suhu awal (°C).</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" domain={['dataMin - 2', 'dataMax + 2']} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" isAnimationActive={false} dataKey="avgShelfLife" name="Shelf-life awal (jam)" fill="#16a34a" radius={[6, 6, 0, 0]} />
              <Line yAxisId="r" dataKey="avgSuhu" name="Suhu (°C)" stroke="#ea580c" strokeWidth={2.5} dot={{ r: 3 }} />
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
                  <p className="text-sm font-semibold text-slate-900">{meta.label}</p>
                  <p className="text-xs text-slate-500">{s.sessions} sesi</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">Rata-rata suhu</dt><dd className="font-semibold">{s.avgSuhu ?? '—'} °C</dd></div>
                <div><dt className="text-slate-500">Rata-rata RH</dt><dd className="font-semibold">{s.avgRh ?? '—'} %</dd></div>
                <div><dt className="text-slate-500">Rata-rata TVOC awal</dt><dd className="font-semibold">{s.avgTvoc ?? '—'} ppb</dd></div>
                <div><dt className="text-slate-500">Shelf-life awal</dt><dd className="font-semibold">{s.avgShelfLife ?? '—'} jam</dd></div>
              </dl>
            </div>
          );
        })}
      </div>

      <p className="rounded-2xl bg-slate-100 p-5 text-sm leading-relaxed text-slate-700">{data.insight}</p>
    </div>
  );
}
