'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/services/api';
import { usePolling } from '@/lib/hooks';
import { formatDateTime, formatDurationShort, formatHoursLeft, STATUS_STYLES, NEUTRAL_STYLE } from '@/lib/utils';
import { useI18n } from '@/context/I18nContext';
import { TICK, TOOLTIP_STYLE, xAxisLabel, yAxisLabel } from '@/lib/chart';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ErrorState, Loading } from '@/components/common/States';
import ShelfLifeChart from '@/components/dashboard/ShelfLifeChart';
import RslOverview from '@/components/rsl/RslOverview';

function MiniChart({ title, data, lines, yTitle }) {
  const { t } = useI18n();
  return (
    <section className="card p-5 sm:p-6">
      <h3 className="font-semibold text-slate-900">{t(title)}</h3>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="elapsed"
              type="number"
              domain={[0, 'dataMax']}
              tickFormatter={(v) => Math.round(v)}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              label={xAxisLabel(t('Waktu sejak tahu masuk (jam)'))}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              width={62}
              label={yAxisLabel(t(yTitle))}
            />
            <Tooltip
              labelFormatter={(v) => t('Jam ke-{n}', { n: Number(v).toFixed(1) })}
              formatter={(v, n, item) => [`${v} ${lines.find((l) => l.key === item.dataKey)?.unit || ''}`.trim(), n]}
              contentStyle={TOOLTIP_STYLE}
            />
            {lines.map((l) => (
              <Line key={l.key} dataKey={l.key} name={t(l.name)} stroke={l.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {lines.length > 1 && (
        <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
          {lines.map((l) => (
            <span key={l.key} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full" style={{ background: l.color }} /> {t(l.name)} ({l.unit})
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function Stat({ label, s, unit, decimals = 1 }) {
  const { t } = useI18n();
  return (
    <div className="card p-4">
      <p className="text-sm font-semibold text-slate-600">{t(label)}</p>
      {s ? (
        <p className="mt-1 text-sm text-slate-500">
          {t('rata-rata')} <b className="text-slate-900">{s.avg.toFixed(decimals)}</b> {unit} · {t('min')} {s.min.toFixed(decimals)} · {t('maks')} {s.max.toFixed(decimals)}
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-400">—</p>
      )}
    </div>
  );
}

export default function SessionDetailPage() {
  const { t } = useI18n();
  const { sessionId } = useParams();
  const { data, error, loading, reload } = usePolling(() => api.getSession(sessionId), 0, [sessionId]);
  const { data: settings } = usePolling(() => api.getSettings(), 0, []);

  const sensorSeries = useMemo(() => {
    if (!data) return [];
    const t0 = new Date(data.session.experimentStartedAt || data.session.masuk).getTime();
    return data.readings.map((r) => ({
      elapsed: (new Date(r.timestamp).getTime() - t0) / 3600000,
      tvoc: r.tvoc,
      suhu: r.suhu,
      rh: r.rh,
    }));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const { session: s, stats, predictions, rslSnapshot } = data;
  const snapshotPending = data.experiment?.rslSnapshotStatus === 'PENDING';
  const snapshotExpected = data.experiment?.rslSnapshotExpectedCount ?? 2;
  const snapshotCompleted = data.experiment?.rslSnapshotCompletedCount ?? 0;
  const finalizationPending = data.experiment?.finalizationStatus === 'PENDING';
  const finalizationExpected = data.experiment?.finalizationExpectedSessionCount ?? 2;
  const finalizationClosed = data.experiment?.finalizationClosedSessionCount ?? 0;
  const finalizationLastAttempt = data.experiment?.finalizationLastAttemptAt;
  const zones = settings?.zones || { segarHours: 24, rawanHours: 8 };
  const style = STATUS_STYLES[s.statusAkhir || s.statusLayak] || NEUTRAL_STYLE;
  const sourceNames = [...new Set((data.readings || []).flatMap((r) => r.sources || (r.source ? [r.source] : [])))];
  const sourceText = sourceNames.length
    ? sourceNames.map((x) => (x === 'mqtt' ? 'MQTT' : x === 'sheet' ? 'Google Sheets' : x === 'http' ? 'HTTP' : x)).join(' + ')
    : t('Sumber tidak tercatat');

  return (
    <div className="space-y-6">
      <Link href="/history" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> {t('Kembali ke riwayat')}
      </Link>

      <div className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{s.sesiCode}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Chamber {s.chamberId} · {formatDateTime(s.masuk)} →{' '}
            {s.selesai
              ? formatDateTime(s.selesai)
              : finalizationPending
                ? t('finalisasi pending')
                : t('berjalan')}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{t('Sumber data')}: {sourceText}</p>
        </div>
        {finalizationPending ? (
          <StatusBadge status="__snapshot">Finalisasi pending</StatusBadge>
        ) : s.status === 'aktif' ? (
          <StatusBadge status="__run">Berjalan</StatusBadge>
        ) : rslSnapshot ? (
          <StatusBadge status="__snapshot">
            {rslSnapshot.status === 'AVAILABLE' ? 'Snapshot RSL tersedia' : 'Snapshot RSL tidak tersedia'}
          </StatusBadge>
        ) : (
          <StatusBadge status={s.statusAkhir} className="!px-3.5 !py-1.5 !text-sm" />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['Durasi', formatDurationShort(s.durasiDetik)],
          [rslSnapshot ? 'Prediksi mock awal (legacy)' : 'Umur simpan awal (prediksi)', s.shelfLifeMulai != null ? `${s.shelfLifeMulai.toFixed(1)} ${t('jam')}` : '—'],
          [
            'Sisa saat keluar',
            rslSnapshot?.status === 'AVAILABLE' && rslSnapshot.primary
              ? `${rslSnapshot.primary.display.lowerHours}–${rslSnapshot.primary.display.upperHours} ${t('jam')}`
              : s.sisaAkhirJam != null
                ? formatHoursLeft(s.sisaAkhirJam * 3600)
                : '—',
          ],
        ].map(([k, v]) => (
          <div key={k} className="card p-4">
            <p className="text-sm font-semibold text-slate-600">{t(k)}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{v}</p>
          </div>
        ))}
      </div>

      {finalizationPending && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          <p className="font-semibold">{t('Finalisasi eksperimen sedang dipulihkan')}</p>
          <p className="mt-1 text-xs leading-relaxed">
            {t('Eksperimen sudah dihentikan. {closed} dari {total} sesi chamber sudah ditutup dan {snapshots} dari {snapshotTotal} snapshot RSL tersimpan. Sistem akan menyelesaikan finalisasi menggunakan waktu henti eksperimen yang asli.', {
              closed: finalizationClosed,
              total: finalizationExpected,
              snapshots: snapshotCompleted,
              snapshotTotal: snapshotExpected,
            })}
          </p>
          {finalizationLastAttempt && (
            <p className="mt-1 text-[11px] text-amber-700">
              {t('Percobaan terakhir')}: {formatDateTime(finalizationLastAttempt)}
            </p>
          )}
        </div>
      )}

      {snapshotPending && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20">
          <p className="font-semibold">{t('Snapshot RSL sedang dipulihkan')}</p>
          <p className="mt-1 text-xs leading-relaxed">
            {t('{n} dari {total} snapshot chamber sudah tersimpan. Snapshot yang hilang akan dipulihkan menggunakan waktu henti eksperimen yang asli, bukan waktu sekarang.', {
              n: snapshotCompleted,
              total: snapshotExpected,
            })}
          </p>
        </div>
      )}

      {!rslSnapshot && snapshotPending && (
        <section className="card p-5 sm:p-6">
          <h3 className="font-semibold text-slate-900">{t('Snapshot RSL sedang dipulihkan')}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {t('Snapshot final chamber ini belum tersedia. Sistem akan menampilkannya setelah pemulihan selesai; tidak ada estimasi pengganti yang dibuat.')}
          </p>
        </section>
      )}

      {rslSnapshot && (
        <section className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">{t('Hasil RSL akhir (snapshot)')}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {t('Disimpan saat eksperimen dihentikan pada {time}. Tidak dihitung ulang menggunakan waktu sekarang.', {
                  time: formatDateTime(rslSnapshot.snapshotAt),
                })}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-500/20">
              {t('Snapshot akhir')}
            </span>
          </div>
          <div className="mt-4">
            <RslOverview
              rsl={rslSnapshot}
              session={rslSnapshot}
              latestReading={data.readings?.[data.readings.length - 1] || null}
              snapshot
            />
          </div>
        </section>
      )}

      {(predictions.length > 1 || !rslSnapshot) && (
      <section className="card p-5 sm:p-6">
        <h3 className="font-semibold text-slate-900">
          {t(rslSnapshot ? 'Tren prediksi mock (legacy)' : 'Prediksi sisa umur simpan')}
        </h3>
        <p className="mb-3 mt-1 text-xs text-slate-500">{t('{n} prediksi sepanjang sesi.', { n: stats.predictions })}</p>
        {predictions.length > 1 ? (
          <ShelfLifeChart data={predictions} zones={zones} xKey="elapsedHours" yKey="shelfLifeJam" color={style.hex} height={260} />
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">{t('Belum ada cukup prediksi.')}</p>
        )}
      </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <MiniChart title="TVOC sepanjang sesi" data={sensorSeries} lines={[{ key: 'tvoc', name: 'TVOC', color: '#7c3aed', unit: 'ppb' }]} yTitle="TVOC (ppb)" />
        <MiniChart
          title="Suhu dan kelembapan sepanjang sesi"
          data={sensorSeries}
          lines={[{ key: 'suhu', name: 'Suhu', color: '#ea580c', unit: '°C' }, { key: 'rh', name: 'Kelembapan', color: '#0284c7', unit: '%' }]}
          yTitle="Suhu (°C) / Kelembapan (%)"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="TVOC" s={stats.tvoc} unit="ppb" decimals={0} />
        <Stat label="Suhu" s={stats.suhu} unit="°C" />
        <Stat label="Kelembapan" s={stats.rh} unit="%" />
      </div>
    </div>
  );
}
