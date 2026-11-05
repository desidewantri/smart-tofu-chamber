'use client';

import { useState } from 'react';
import { CheckCircle2, MessageCircle, Plus, Send, TriangleAlert, X } from 'lucide-react';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { useToast } from '@/components/common/Toast';
import { SettingsCard } from './SettingsCard';

/** 6281234567890 -> +62 812-3456-7890 (hanya untuk tampilan) */
function prettyPhone(p) {
  const d = String(p);
  if (!d.startsWith('62')) return d;
  const r = d.slice(2);
  return `+62 ${r.slice(0, 3)}-${r.slice(3, 7)}-${r.slice(7)}`;
}

function WhatsAppCard({ settings, onSave }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const wa = settings.notifications.whatsapp || { recipients: [] };
  const recipients = wa.recipients || [];
  const status = settings.whatsappStatus || { configured: false };
  const zones = settings.zones || { segarHours: 24, rawanHours: 8 };
  const offlineMin = (settings.updateIntervalMinutes || 5) * 3;
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);

  const save = (patch) => onSave({ notifications: { whatsapp: patch } });

  async function add(e) {
    e.preventDefault();
    if (!phone.trim()) return;
    if (await save({ recipients: [...recipients, phone.trim()] })) setPhone('');
  }

  async function test() {
    setSending(true);
    try {
      const res = await api.testWhatsApp();
      toast(res.message || 'Pesan uji dikirim');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  }

  // Notifikasi selalu aktif. Yang bisa menghalangi hanya token dan nomor tujuan.
  const ready = status.configured && recipients.length > 0;
  let banner;
  if (!status.configured) banner = t('Token Fonnte belum diisi. Isi FONNTE_TOKEN di backend/.env lalu jalankan ulang backend.');
  else if (!recipients.length) banner = t('Belum ada nomor tujuan. Tambahkan minimal satu nomor agar notifikasi terkirim.');
  else if (status.dryRun) banner = t('Mode uji aktif (WA_DRY_RUN=true): pesan hanya dicetak di terminal backend, tidak benar-benar dikirim.');
  else banner = t('Aktif: pesan dikirim lewat Fonnte ke {n} nomor.', { n: recipients.length });

  const events = [
    { label: t('Tahu baru masuk'), when: t('data sensor pertama diterima; estimasi menunggu status operator') },
    { label: t('Batas bawah M1 mulai terbatas'), when: t('≤ {h} jam', { h: zones.segarHours }) },
    { label: t('Batas bawah M1 mendekati'), when: t('≤ {h} jam', { h: zones.rawanHours }) },
    { label: t('Chamber terputus'), when: t('{m} menit tanpa data', { m: offlineMin }) },
    { label: t('Baterai alat lemah'), when: '< 20%' },
  ];

  return (
    <SettingsCard
      title="Notifikasi WhatsApp"
      description="Selalu aktif. TOSCHA mengirim pesan otomatis ke semua nomor di bawah setiap kali kondisi berubah."
    >
      <div
        className={
          ready
            ? 'flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20'
            : 'flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20'
        }
      >
        {ready ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
        <p>{banner}</p>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        {t('Notifikasi RSL memakai batas bawah M1 dari envelope historis. Bukan countdown mock, bukan jaminan keamanan, dan tidak mengubah status sampel operator.')}
      </p>
      <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200">
        {events.map((e) => (
          <li key={e.label} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="text-slate-800">{e.label}</span>
            <span className="ml-auto text-right text-xs text-slate-500">{e.when}</span>
          </li>
        ))}
      </ul>

      <div>
        <p className="label">{t('Nomor WhatsApp tujuan')}</p>
        {recipients.length === 0 ? (
          <p className="text-sm text-slate-500">{t('Belum ada nomor tujuan.')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {recipients.map((r) => (
              <li key={r} className="flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm font-medium text-slate-700">
                <MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> {prettyPhone(r)}
                <button
                  type="button"
                  onClick={() => save({ recipients: recipients.filter((x) => x !== r) })}
                  className="rounded-full p-1 text-slate-400 hover:bg-white hover:text-red-600"
                  aria-label={t('Hapus nomor')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="mt-3 flex gap-2">
          <input
            className="input"
            inputMode="tel"
            placeholder={t('mis. 0812 3456 7890')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-label={t('Nomor WhatsApp tujuan')}
          />
          <button type="submit" className="btn-outline shrink-0" disabled={!phone.trim() || recipients.length >= 5}>
            <Plus className="h-4 w-4" /> {t('Tambah')}
          </button>
        </form>
        <p className="mt-1.5 text-xs text-slate-500">{t('Maksimal 5 nomor. Awalan 0 otomatis diubah menjadi 62.')}</p>
      </div>

      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={test} disabled={sending || !recipients.length}>
          <Send className="h-4 w-4" /> {sending ? t('Mengirim…') : t('Kirim pesan uji')}
        </button>
      </div>
    </SettingsCard>
  );
}

/** Semua notifikasi selalu aktif; halaman ini hanya mengatur nomor WhatsApp tujuan. */
export default function NotificationSettingsTab({ settings, onSave }) {
  return <WhatsAppCard settings={settings} onSave={onSave} />;
}
