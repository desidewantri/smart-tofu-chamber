'use client';

import { useRef } from 'react';
import { Cpu, Droplets, Info, Thermometer, Wind } from 'lucide-react';
import { api } from '@/services/api';
import { usePolling, useCountdown } from '@/lib/hooks';
import { classifyShelfLife, cn, formatDurationLong, MODEL_LABEL, STATUS_STYLES, NEUTRAL_STYLE } from '@/lib/utils';
import { StatusBadge, ZonePill } from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';
import ShelfLifeChart from '@/components/dashboard/ShelfLifeChart';

const PARAMS = [
  { key: 'tvoc', label: 'TVOC', icon: Wind, decimals: 0 },
  { key: 'suhu', label: 'Suhu', icon: Thermometer, decimals: 1 },
  { key: 'rh', label: 'Kelembapan', icon: Droplets, decimals: 1 },
];

function Body({ d, zones, fetchedAt }) {
  const seconds = useCountdown(d.remainingSeconds, fetchedAt);
  const live = d.session?.status === 'aktif';
  const status = live ? classifyShelfLife((seconds ?? 0) / 3600, zones) : d.status;
  const style = STATUS_STYLES[status] || NEUTRAL_STYLE;

  return (
    <div className="space-y-6">
      {!live && (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Chamber ini tidak punya sesi aktif. Menampilkan sesi terakhir: <b>{d.session.sesiCode}</b>.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className={cn('rounded-2xl border-2 p-5 shadow-card', style.card)}>
          <p className="text-sm font-semibold text-slate-600">Status Saat Ini</p>
          <div className="mt-3"><StatusBadge status={status} className="!px-3.5 !py-1.5 !text-sm" /></div>
          <p className="mt-3 text-xs text-slate-500">
            Zona: Layak &gt; {zones.segarHours} jam · Segera {zones.rawanHours}–{zones.segarHours} jam · Tidak Layak &lt; {zones.rawanHours} jam
          </p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-semibold text-slate-600">Estimasi Sisa Shelf-Life</p>
          <p className={cn('mt-2 text-3xl font-bold tabular-nums', style.text)}>{formatDurationLong(seconds ?? 0)}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <Cpu className="h-3.5 w-3.5" /> berdasarkan model prediksi {MODEL_LABEL[d.modelUsed] || d.modelUsed}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PARAMS.map(({ key, label, icon: Icon, decimals }) => {
          const r = d.sensors?.[key];
          return (
            <div key={key} className="card p-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Icon className="h-4 w-4" /> {label}</span>
                {r && <ZonePill zone={r.zone} />}
              </div>
              <p className="mt-3 text-3xl font-bold tabular-nums text-slate-900">
                {r ? Number(r.value).toFixed(decimals) : '—'} <span className="text-base font-medium text-slate-500">{r?.unit}</span>
              </p>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">{d.risks?.[key]}</p>
            </div>
          );
        })}
      </div>

      <div className="card p-5 sm:p-6">
        <h3 className="flex items-center gap-2 font-semibold text-slate-900"><Info className="h-4 w-4 text-brand-600" /> Interpretasi Kondisi</h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{d.interpretation}</p>
      </div>

      <div className="card p-5 sm:p-6">
        <h3 className="font-semibold text-slate-900">Tren Shelf-Life</h3>
        <p className="mb-3 mt-1 text-xs text-slate-500">Estimasi sisa shelf-life (jam) dari prediksi pada periode terpilih.</p>
        {d.trend.length > 1 ? (
          <ShelfLifeChart data={d.trend} zones={zones} color={style.hex} height={260} />
        ) : (
          <EmptyState title="Belum cukup data prediksi" description="Grafik muncul setelah ada beberapa prediksi pada periode ini." />
        )}
      </div>
    </div>
  );
}

export default function ConditionAnalysisTab({ chamberId, period }) {
  const { data, error, loading, fetchedAt, reload } = usePolling(
    () => api.getCondition({ chamberId, period }),
    30000,
    [chamberId, period]
  );
  const zonesRef = useRef({ segarHours: 24, rawanHours: 8 });
  const { data: settings } = usePolling(() => api.getSettings(), 0, []);
  if (settings?.zones) zonesRef.current = settings.zones;

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data.session) {
    return (
      <div className="card">
        <EmptyState title="Belum ada sesi di chamber ini" description={data.interpretation} />
      </div>
    );
  }
  return <Body d={data} zones={zonesRef.current} fetchedAt={fetchedAt} />;
}
