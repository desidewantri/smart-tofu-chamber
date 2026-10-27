'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Droplets, LineChart, LogOut, Thermometer, Wind, Wifi, WifiOff } from 'lucide-react';
import { api } from '@/services/api';
import { useCountdown } from '@/lib/hooks';
import { classifyShelfLife, cn, formatRelative, STATUS_STYLES, NEUTRAL_STYLE } from '@/lib/utils';
import { StatusBadge } from '@/components/common/StatusBadge';
import Modal from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import ShelfLifeTimer from './ShelfLifeTimer';
import ShelfLifeChart from './ShelfLifeChart';
import SensorBar from './SensorBar';
import ModelIndicator from './ModelIndicator';

export default function ChamberCard({ card, zones, thresholds, fetchedAt, onChanged }) {
  const { chamber, session, sensors, chart } = card;
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const seconds = useCountdown(session.sisaDetik, fetchedAt);
  const status = classifyShelfLife(seconds / 3600, zones);
  const style = STATUS_STYLES[status] || NEUTRAL_STYLE;

  async function closeSession() {
    setBusy(true);
    try {
      const res = await api.closeSession(chamber.chamberId);
      toast(res.message || 'Sesi ditutup');
      setConfirm(false);
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={cn('rounded-2xl border-2 p-5 shadow-card transition sm:p-6', style.card)}>
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{chamber.name}</h2>
            <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">
              {chamber.code}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            {chamber.connected ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-slate-400" />
            )}
            {chamber.connected ? 'Terhubung' : 'Terputus'} · update {formatRelative(chamber.lastSeenAt)} · {session.sesiCode}
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      {/* Timer */}
      <div className="mt-5 rounded-xl bg-white/80 p-4 ring-1 ring-inset ring-slate-200/70">
        <ShelfLifeTimer seconds={seconds} textClass={style.text} />
      </div>

      {/* Grafik */}
      <section className="mt-5">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Estimasi Sisa Shelf-Life</h3>
        {chart.length > 1 ? (
          <ShelfLifeChart data={chart} zones={zones} color={style.hex} />
        ) : (
          <p className="rounded-xl bg-white/70 py-10 text-center text-sm text-slate-500">Menunggu prediksi pertama…</p>
        )}
      </section>

      {/* Sensor */}
      <section className="mt-5 space-y-3.5">
        <h3 className="text-sm font-semibold text-slate-700">Kondisi Sensor Saat Ini</h3>
        {sensors ? (
          <>
            <SensorBar icon={Wind} label="TVOC" reading={sensors.tvoc} limits={thresholds.tvoc} />
            <SensorBar icon={Thermometer} label="Suhu" reading={sensors.suhu} limits={thresholds.suhu} decimals={1} />
            <SensorBar icon={Droplets} label="Kelembapan" reading={sensors.rh} limits={thresholds.rh} decimals={1} />
          </>
        ) : (
          <p className="text-sm text-slate-500">Belum ada pembacaan sensor.</p>
        )}
      </section>

      {/* Footer */}
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4">
        <ModelIndicator model={session.modelUsed} />
        <div className="flex flex-wrap gap-2">
          <Link href={`/analysis?chamber=${chamber.chamberId}`} className="btn-outline !px-3.5 !py-2">
            <LineChart className="h-4 w-4" /> Lihat Analisis
          </Link>
          <button onClick={() => setConfirm(true)} className="btn-primary !px-3.5 !py-2">
            <LogOut className="h-4 w-4" /> Tahu Sudah Keluar
          </button>
        </div>
      </footer>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Tutup sesi chamber ini?"
        footer={
          <>
            <button className="btn-outline" onClick={() => setConfirm(false)}>Batal</button>
            <button className="btn-primary" onClick={closeSession} disabled={busy}>
              {busy ? 'Menutup…' : 'Ya, tahu sudah keluar'}
            </button>
          </>
        }
      >
        Sesi <b>{session.sesiCode}</b> di <b>{chamber.name}</b> akan ditandai selesai dan masuk ke Riwayat. Sesi baru
        dibuat otomatis ketika sensor mengirim data tahu berikutnya.
      </Modal>
    </article>
  );
}
