'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Droplets, LineChart, Pencil, Power, Thermometer, Wind } from 'lucide-react';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { usePolling } from '@/lib/hooks';
import { formatDateTime, formatDurationShort, formatHoursLeft, formatRelative } from '@/lib/utils';
import { ConnectionBadge, StatusBadge } from '@/components/common/StatusBadge';
import { ErrorState, Loading } from '@/components/common/States';
import SensorBar from '@/components/dashboard/SensorBar';
import { useToast } from '@/components/common/Toast';

export default function ChamberDetailPage() {
  const { id } = useParams();
  const { toast } = useToast();
  const { t } = useI18n();
  const { data, error, loading, reload } = usePolling(() => api.getChamber(id), 10000, [id]);
  const { data: settings } = usePolling(() => api.getSettings(), 0, []);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const { chamber, activeSession, sensors, recentSessions } = data;
  const th = settings?.thresholds || { tvoc: { perhatian: 400 }, suhu: { perhatian: 30 }, rh: { perhatian: 85 } };

  async function save() {
    try {
      await api.updateChamber(id, { name });
      toast('Nama chamber diperbarui');
      setEditing(false);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  async function toggle() {
    try {
      await api.updateChamber(id, { enabled: !chamber.enabled });
      toast(chamber.enabled ? 'Chamber dinonaktifkan' : 'Chamber diaktifkan');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/chambers" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> {t('Kembali ke daftar chamber')}
      </Link>

      <div className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input className="input !w-64" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <button className="btn-primary !py-2" onClick={save}>{t('Simpan')}</button>
              <button className="btn-outline !py-2" onClick={() => setEditing(false)}>{t('Batal')}</button>
            </div>
          ) : (
            <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
              {chamber.name}
              <button onClick={() => { setName(chamber.name); setEditing(true); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t('Ubah nama')}>
                <Pencil className="h-4 w-4" />
              </button>
            </h2>
          )}
          <p className="mt-1 text-sm text-slate-500">
            {t('Pembaruan terakhir')}: {formatRelative(chamber.lastSeenAt).toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionBadge enabled={chamber.enabled} connected={chamber.connected} />
          <button className="btn-outline !py-2" onClick={toggle}>
            <Power className="h-4 w-4" /> {chamber.enabled ? t('Nonaktifkan') : t('Aktifkan')}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h3 className="font-semibold text-slate-900">{t('Sesi Saat Ini')}</h3>
          {activeSession ? (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-lg font-bold">{activeSession.sesiCode}</span>
                <StatusBadge status={activeSession.statusLayak} />
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-slate-500">{t('Tahu masuk')}</dt><dd className="font-medium">{formatDateTime(activeSession.masuk)}</dd></div>
                <div><dt className="text-slate-500">{t('Berjalan')}</dt><dd className="font-medium">{formatDurationShort(activeSession.durasiDetik)}</dd></div>
                <div><dt className="text-slate-500">{t('Sisa umur simpan')}</dt><dd className="font-medium">{formatHoursLeft(activeSession.sisaDetik)}</dd></div>
                <div><dt className="text-slate-500">{t('Jumlah pembacaan')}</dt><dd className="font-medium">{activeSession.readingCount}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Link href={`/analysis?chamber=${chamber.chamberId}`} className="btn-outline !px-3 !py-1.5 !text-xs">
                  <LineChart className="h-3.5 w-3.5" /> {t('Lihat Analisis')}
                </Link>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t('Belum ada sesi aktif. Sesi dibuat otomatis saat sensor mengirim data pertama.')}</p>
          )}
        </section>

        <section className="card p-5 sm:p-6">
          <h3 className="font-semibold text-slate-900">{t('Kondisi Sensor Saat Ini')}</h3>
          {sensors ? (
            <div className="mt-4 space-y-4">
              <SensorBar icon={Wind} label="TVOC" reading={sensors.tvoc} limits={th.tvoc} />
              <SensorBar icon={Thermometer} label="Suhu" reading={sensors.suhu} limits={th.suhu} decimals={1} />
              <SensorBar icon={Droplets} label="Kelembapan" reading={sensors.rh} limits={th.rh} decimals={1} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t('Belum ada pembacaan sensor.')}</p>
          )}
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between p-5 sm:px-6">
          <h3 className="font-semibold text-slate-900">{t('Sesi Terakhir')}</h3>
          <Link href="/history" className="text-sm font-semibold text-brand-700 hover:underline">{t('Semua riwayat')}</Link>
        </div>
        {recentSessions.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-500">{t('Belum ada sesi yang selesai di chamber ini.')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {recentSessions.map((s) => (
              <li key={s.id}>
                <Link href={`/history/${s.sesiCode}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3.5 text-sm hover:bg-slate-50">
                  <span className="font-semibold text-slate-900">{s.sesiCode}</span>
                  <span className="text-slate-500">{formatDateTime(s.masuk)} · {formatDurationShort(s.durasiDetik)}</span>
                  <StatusBadge status={s.statusAkhir} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
