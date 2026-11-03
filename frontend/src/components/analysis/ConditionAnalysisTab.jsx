'use client';

import { useRef } from 'react';
import { useI18n } from '@/context/I18nContext';
import { api } from '@/services/api';
import { usePolling, useCountdown } from '@/lib/hooks';
import { getLocale } from '@/lib/locale';
import {
  classifyShelfLife,
  cn,
  formatDurationLong,
  formatHoursLeft,
  formatRelative,
  STATUS,
  STATUS_STYLES,
  NEUTRAL_STYLE,
} from '@/lib/utils';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState, ErrorState, Loading } from '@/components/common/States';
import ShelfLifeChart from '@/components/dashboard/ShelfLifeChart';
import SensorHistoryChart from './SensorHistoryChart';

const SENSORS = [
  { key: 'suhu', label: 'Suhu', unit: '°C', yLabel: 'Suhu (°C)', color: '#f97316', decimals: 1, minPad: 1 },
  { key: 'rh', label: 'Kelembapan', unit: '%', yLabel: 'Kelembapan (%)', color: '#0ea5e9', decimals: 1, minPad: 2 },
  {
    key: 'tvoc',
    label: 'TVOC',
    unit: 'ppb',
    yLabel: 'TVOC (ppb)',
    color: '#0d9488',
    decimals: 0,
    fromZero: true,
    // Nilai AGS10 bisa puluhan ribu: sumbu ditulis dalam "ribu ppb" agar angkanya pendek.
    bigScale: { at: 5000, scale: 1000, yLabel: 'TVOC (ribu ppb)' },
    note: 'TVOC yang turun di 4 jam awal itu normal (sensor masih pemanasan).',
  },
];

const fmtNum = (v, d) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString(getLocale(), { minimumFractionDigits: d, maximumFractionDigits: d });

/** "Rabu, 4 Nov" + "sekitar pukul 01.00" (dibulatkan ke jam terdekat; prediksi tidak setepat menit). */
function whenText(ms, roundToHour = true) {
  const d = new Date(ms);
  if (roundToHour) {
    d.setMinutes(d.getMinutes() + 30, 0, 0);
    d.setMinutes(0);
  }
  const day = new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'short' }).format(d);
  const time = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(d);
  return { day, time };
}

function recommendations(status, live, untilDay) {
  if (!live) return ['Sesi ini sudah selesai. Rekomendasi muncul lagi saat ada tahu baru di chamber.'];
  const general = [
    'Jaga suhu ruang tetap stabil — kenaikan suhu mempercepat penurunan kualitas.',
    'Pastikan chamber tertutup rapat agar pembacaan TVOC akurat.',
  ];
  if (status === STATUS.TIDAK) {
    return [
      'Tahu sudah tidak layak dikonsumsi; keluarkan dari chamber lalu tekan Tahu Sudah Keluar.',
      'Bersihkan wadah chamber sebelum dipakai untuk tahu berikutnya.',
    ];
  }
  if (status === STATUS.SEGERA) {
    return ['Tahu sebaiknya segera dikonsumsi atau dijual.', { text: 'Rencanakan sebelum {when}.', when: untilDay }, ...general];
  }
  return ['Tahu masih layak; belum perlu tindakan.', { text: 'Rencanakan konsumsi atau penjualan sebelum {when}.', when: untilDay }, ...general];
}

function Kpi({ label, children, className }) {
  return (
    <div className={cn('card px-4 py-3.5', className)}>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      {children}
    </div>
  );
}

function Body({ d, zones, fetchedAt }) {
  const { t } = useI18n();
  const seconds = useCountdown(d.remainingSeconds, fetchedAt);
  const live = d.session?.status === 'aktif';
  const status = live ? classifyShelfLife((seconds ?? 0) / 3600, zones) : d.status;
  const style = STATUS_STYLES[status] || NEUTRAL_STYLE;

  const nowMs = Date.now();
  const masukMs = new Date(d.session.masuk).getTime();
  const endMs = d.session.selesai ? new Date(d.session.selesai).getTime() : nowMs;
  const storedSec = Math.max(0, (endMs - masukMs) / 1000);
  const masuk = whenText(masukMs, false);
  // "Perkiraan Tidak Layak" = saat status berubah ke Tidak Layak Konsumsi (sisa umur < Batas Rawan).
  const toTidakSec = (seconds ?? 0) - zones.rawanHours * 3600;
  const until = live && toTidakSec > 0 ? whenText(nowMs + toTidakSec * 1000) : null;
  // Bila sudah lewat: kapan status pertama kali berubah ke Tidak Layak (prediksi pertama < Batas Rawan).
  const firstBad = !until ? (d.trend || []).find((p) => p.shelfLife < zones.rawanHours) : null;
  const passedAt = firstBad ? whenText(masukMs + firstBad.elapsedHours * 3600000) : null;
  const untilText = until ? `${until.day} ±${until.time}` : '';
  const q = d.dataQuality;

  return (
    <div className="space-y-4">
      {!live && (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          {t('Chamber ini tidak punya sesi aktif. Menampilkan sesi terakhir:')} <b>{d.session.sesiCode}</b>.
        </p>
      )}

      {/* Ringkasan (kartu kecil) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={cn('rounded-2xl border-2 px-4 py-3.5 shadow-card', style.card)}>
          <p className="text-xs font-semibold text-slate-500">{t('Status Saat Ini')}</p>
          <div className="mt-1.5"><StatusBadge status={status} /></div>
          <p className="mt-1.5 text-xs text-slate-500">
            {t('Sesi')} {d.session.sesiCode} · {d.chamber?.name || `Chamber ${d.session.chamberId}`}
          </p>
        </div>
        <Kpi label={t('Perkiraan Sisa Umur')}>
          <p className={cn('mt-1 text-2xl font-bold tabular-nums', style.text)}>{formatHoursLeft(seconds ?? 0)}</p>
        </Kpi>
        <Kpi label={t('Perkiraan Tidak Layak')}>
          {until ? (
            <>
              <p className="mt-1 text-lg font-bold capitalize text-slate-900">{until.day}</p>
              <p className="text-xs text-slate-500">{t('sekitar pukul {t}', { t: until.time })}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-lg font-bold text-slate-900">{live ? t('Sudah lewat') : '—'}</p>
              {passedAt && (
                <p className="text-xs text-slate-500">{t('status berubah {d} ±{t}', { d: passedAt.day, t: passedAt.time })}</p>
              )}
            </>
          )}
        </Kpi>
        <Kpi label={t('Lama Disimpan')}>
          <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{formatDurationLong(storedSec)}</p>
          <p className="text-xs text-slate-500">{t('masuk {d}, {t}', { d: masuk.day, t: masuk.time })}</p>
        </Kpi>
      </div>

      {/* Grafik sensor sepanjang sesi */}
      <div className="grid gap-4 lg:grid-cols-3">
        {SENSORS.map((s) => {
          const st = d.stats?.[s.key];
          const big = s.bigScale && (st?.max ?? 0) >= s.bigScale.at;
          const scale = big ? s.bigScale.scale : 1;
          const yLabel = big ? s.bigScale.yLabel : s.yLabel;
          const cur = d.sensors?.[s.key]?.value;
          return (
            <div key={s.key} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{t(s.label)}</p>
                  <p className="text-xs text-slate-500">{t('sepanjang sesi')}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold tabular-nums text-slate-900">
                    {fmtNum(cur, s.decimals)} <span className="text-sm font-medium text-slate-500">{s.unit}</span>
                  </p>
                  <p className="text-xs text-slate-500">{t('saat ini')}</p>
                </div>
              </div>
              <div className="mt-3">
                {d.history?.length > 1 ? (
                  <SensorHistoryChart
                    data={d.history}
                    dataKey={s.key}
                    color={s.color}
                    yLabel={yLabel}
                    unit={s.unit}
                    decimals={s.decimals}
                    scale={scale}
                    minPad={s.minPad ?? 1}
                    fromZero={Boolean(s.fromZero)}
                  />
                ) : (
                  <p className="py-12 text-center text-xs text-slate-400">{t('Grafik muncul setelah ada beberapa data sensor.')}</p>
                )}
              </div>
              {st && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>{t('Rata-rata')} <b>{fmtNum(st.avg, s.decimals)}</b></span>
                  <span>{t('Min')} <b>{fmtNum(st.min, s.decimals)}</b></span>
                  <span>{t('Maks')} <b>{fmtNum(st.max, s.decimals)}</b></span>
                </div>
              )}
              {s.note && <p className="mt-1.5 text-xs text-slate-500">{t(s.note)}</p>}
            </div>
          );
        })}
      </div>

      {/* Tren + rekomendasi + kualitas data */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-5 sm:p-6 xl:col-span-2">
          <h3 className="font-semibold text-slate-900">{t('Tren Umur Simpan')}</h3>
          <p className="mb-3 mt-1 text-xs text-slate-500">{t('Perkiraan sisa umur simpan dari waktu ke waktu sejak tahu masuk.')}</p>
          {d.trend.length > 1 ? (
            <ShelfLifeChart data={d.trend} zones={zones} color={style.hex} height={280} />
          ) : (
            <EmptyState title="Belum cukup data prediksi" description="Grafik muncul setelah ada beberapa prediksi pada periode ini." />
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold text-slate-900">{t('Rekomendasi')}</h3>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
              {recommendations(status, live, untilText).map((r, i) => (
                <li key={i}>{typeof r === 'string' ? t(r) : t(r.text, { when: r.when })}</li>
              ))}
            </ul>
          </div>

          {q && (
            <div className="card p-5">
              <h3 className="font-semibold text-slate-900">{t('Kualitas Data')}</h3>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
                <dt className="text-slate-500">{t('Pembacaan')}</dt>
                <dd className="text-right font-semibold text-slate-900">{t('{n} data', { n: q.readings.toLocaleString(getLocale()) })}</dd>
                <dt className="text-slate-500">{t('Data terakhir')}</dt>
                <dd className="text-right font-semibold text-slate-900">{formatRelative(q.lastReadingAt)}</dd>
                <dt className="text-slate-500">{t('Interval')}</dt>
                <dd className="text-right font-semibold text-slate-900">{t('tiap {n} menit', { n: q.intervalMinutes })}</dd>
                <dt className="text-slate-500">{t('Data hilang')}</dt>
                <dd className={cn('text-right font-semibold', q.missing ? 'text-amber-700' : 'text-emerald-700')}>{q.missing}</dd>
              </dl>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn('h-full rounded-full', q.completeness >= 90 ? 'bg-emerald-500' : q.completeness >= 70 ? 'bg-amber-500' : 'bg-red-500')}
                  style={{ width: `${q.completeness}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{t('Kelengkapan data {n}%', { n: q.completeness })}</p>
            </div>
          )}
        </div>
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
