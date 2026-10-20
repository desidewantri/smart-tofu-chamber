'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boxes, Droplets, LineChart, LogOut, Thermometer, Wind } from 'lucide-react';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { useCountdown } from '@/lib/hooks';
import { classifyShelfLife, cn, formatRelative, STATUS_STYLES, NEUTRAL_STYLE } from '@/lib/utils';
import { StatusBadge } from '@/components/common/StatusBadge';
import Modal from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import ShelfLifeTimer from './ShelfLifeTimer';
import ShelfLifeChart from './ShelfLifeChart';
import { SensorTile } from './SensorBar';

/** Kartu chamber ringkas: seluruh isi muat dalam satu layar, tanpa gulir panjang. */
export default function ChamberCard({ card, zones, thresholds, fetchedAt, onChanged }) {
  const { chamber, session, sensors, chart } = card;
  const { toast } = useToast();
  const { t } = useI18n();
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
    <article className={cn('flex flex-col gap-2.5 rounded-2xl border-2 p-3.5 shadow-card transition', style.card)}>
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-inset ring-slate-200/70', style.text)}>
            <Boxes className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold leading-tight text-brand-900">{chamber.name}</h2>
            <p className="truncate text-xs text-slate-500">
              {t('ID Sesi')} {session.sesiCode}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('flex items-center justify-end gap-1.5 text-xs font-semibold', chamber.connected ? 'text-emerald-600' : 'text-slate-400')}>
            <span className={cn('h-2 w-2 rounded-full', chamber.connected ? 'bg-emerald-500' : 'bg-slate-400')} />
            {chamber.connected ? t('Terhubung') : t('Terputus')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('Diperbarui')} {formatRelative(chamber.lastSeenAt).toLowerCase()}
          </p>
        </div>
      </header>

      {/* Hitung mundur + status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/80 px-3.5 py-2 ring-1 ring-inset ring-slate-200/70">
        <ShelfLifeTimer seconds={seconds} textClass={style.text} />
        <StatusBadge status={status} className="!px-3 !py-1 !text-[13px]" />
      </div>

      {/* Grafik */}
      <section>
        <h3 className="mb-0.5 text-xs font-semibold text-slate-700 [@media(max-height:700px)]:hidden">{t('Perkiraan Sisa Umur Simpan')}</h3>
        {chart.length > 1 ? (
          <ShelfLifeChart data={chart} zones={zones} color={style.hex} heightClass="h-[150px] [@media(max-height:700px)]:h-[112px] [@media(min-height:800px)]:h-[175px]" />
        ) : (
          <p className="rounded-xl bg-white/70 py-10 text-center text-sm text-slate-500">{t('Menunggu prediksi pertama…')}</p>
        )}
      </section>

      {/* Sensor */}
      <section>
        <h3 className="mb-1 text-xs font-semibold text-slate-700 [@media(max-height:700px)]:hidden">{t('Kondisi Sensor Saat Ini')}</h3>
        {sensors ? (
          <div className="grid grid-cols-3 gap-2">
            <SensorTile icon={Wind} label="TVOC" reading={sensors.tvoc} limits={thresholds.tvoc} />
            <SensorTile icon={Thermometer} label="Suhu" reading={sensors.suhu} limits={thresholds.suhu} decimals={1} />
            <SensorTile icon={Droplets} label="Kelembapan" reading={sensors.rh} limits={thresholds.rh} decimals={1} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t('Belum ada pembacaan sensor.')}</p>
        )}
      </section>

      {/* Tombol */}
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/70 pt-2.5">
        <Link href={`/analysis?chamber=${chamber.chamberId}`} className="btn-outline !px-3 !py-1.5 !text-xs">
          <LineChart className="h-3.5 w-3.5" /> {t('Lihat Analisis')}
        </Link>
        <button onClick={() => setConfirm(true)} className="btn-primary !px-3 !py-1.5 !text-xs">
          <LogOut className="h-3.5 w-3.5" /> {t('Tahu Sudah Keluar')}
        </button>
      </footer>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Tutup sesi chamber ini?"
        footer={
          <>
            <button className="btn-outline" onClick={() => setConfirm(false)}>{t('Batal')}</button>
            <button className="btn-primary" onClick={closeSession} disabled={busy}>
              {busy ? t('Menutup…') : t('Ya, tahu sudah keluar')}
            </button>
          </>
        }
      >
        {t('Sesi')} <b>{session.sesiCode}</b> {t('di')} <b>{chamber.name}</b> {t('akan ditandai selesai dan masuk ke Riwayat. Sesi baru dibuat otomatis ketika sensor mengirim data tahu berikutnya.')}
      </Modal>
    </article>
  );
}
