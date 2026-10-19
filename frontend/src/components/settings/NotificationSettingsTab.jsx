'use client';

import { useState } from 'react';
import { CheckCircle2, MessageCircle, Plus, Send, TriangleAlert, X } from 'lucide-react';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { useToast } from '@/components/common/Toast';
import { SettingsCard, Toggle } from './SettingsCard';

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
  const wa = settings.notifications.whatsapp || { enabled: false, recipients: [] };
  const status = settings.whatsappStatus || { configured: false };
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);

  const save = (patch) => onSave({ notifications: { whatsapp: patch } });

  async function add(e) {
    e.preventDefault();
    if (!phone.trim()) return;
    if (await save({ recipients: [...wa.recipients, phone.trim()] })) setPhone('');
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

  return (
    <SettingsCard title="Notifikasi WhatsApp" description="Kirim pesan WhatsApp saat status chamber berubah. Setiap kejadian dikirim sekali per sesi.">
      <div
        className={
          status.configured
            ? 'flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20'
            : 'flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20'
        }
      >
        {status.configured ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
        <p>
          {status.configured
            ? status.dryRun
              ? t('Mode uji aktif (WA_DRY_RUN=true): pesan hanya dicetak di terminal backend, tidak benar-benar dikirim.')
              : t('Backend siap mengirim WhatsApp lewat Fonnte.')
            : t('Token Fonnte belum diisi. Isi FONNTE_TOKEN di backend/.env lalu jalankan ulang backend.')}
        </p>
      </div>

      <Toggle
        label="Kirim notifikasi ke WhatsApp"
        description="Memakai kejadian yang sama dengan notifikasi lonceng di atas."
        checked={wa.enabled}
        onChange={(v) => save({ enabled: v })}
      />

      <div>
        <p className="label">{t('Nomor WhatsApp tujuan')}</p>
        {wa.recipients.length === 0 ? (
          <p className="text-sm text-slate-500">{t('Belum ada nomor tujuan.')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {wa.recipients.map((r) => (
              <li key={r} className="flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm font-medium text-slate-700">
                <MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> {prettyPhone(r)}
                <button
                  type="button"
                  onClick={() => save({ recipients: wa.recipients.filter((x) => x !== r) })}
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
          <button type="submit" className="btn-outline shrink-0" disabled={!phone.trim() || wa.recipients.length >= 5}>
            <Plus className="h-4 w-4" /> {t('Tambah')}
          </button>
        </form>
        <p className="mt-1.5 text-xs text-slate-500">{t('Maksimal 5 nomor. Awalan 0 otomatis diubah menjadi 62.')}</p>
      </div>

      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={test} disabled={sending || !wa.recipients.length}>
          <Send className="h-4 w-4" /> {sending ? t('Mengirim…') : t('Kirim pesan uji')}
        </button>
      </div>
    </SettingsCard>
  );
}

export default function NotificationSettingsTab({ settings, onSave }) {
  const { t } = useI18n();
  const n = settings.notifications;
  const set = (patch) => onSave({ notifications: patch });

  return (
    <div className="space-y-6">
      <SettingsCard title="Notifikasi" description="Pilih kejadian yang diberitahukan, di ikon lonceng dan di WhatsApp.">
        <div className="divide-y divide-slate-100">
          <div className="pb-3">
            <Toggle label="Aktifkan notifikasi" description="Matikan untuk menghentikan semua notifikasi." checked={n.enabled} onChange={(v) => set({ enabled: v })} />
          </div>
          <div className="py-3">
            <Toggle label="Segera Jual" description="Saat sisa umur simpan masuk zona Segera Jual." checked={n.onSegeraJual} onChange={(v) => set({ onSegeraJual: v })} />
          </div>
          <div className="py-3">
            <Toggle label="Tidak Layak Jual" description="Saat sisa umur simpan di bawah batas rawan." checked={n.onTidakLayak} onChange={(v) => set({ onTidakLayak: v })} />
          </div>
          <div className="pt-3">
            <Toggle label="Chamber terputus" description="Saat chamber dengan sesi aktif berhenti mengirim data." checked={n.onOffline} onChange={(v) => set({ onOffline: v })} />
          </div>
        </div>
        <p className="text-xs text-slate-500">{t('Perubahan tersimpan otomatis.')}</p>
      </SettingsCard>
      <WhatsAppCard settings={settings} onSave={onSave} />
    </div>
  );
}
