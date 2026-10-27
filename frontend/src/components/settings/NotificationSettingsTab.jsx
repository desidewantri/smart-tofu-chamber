'use client';

import { SettingsCard, Toggle } from './SettingsCard';

export default function NotificationSettingsTab({ settings, onSave }) {
  const n = settings.notifications;
  const set = (patch) => onSave({ notifications: patch });

  return (
    <SettingsCard title="Notifikasi" description="Pilih kejadian yang muncul di ikon lonceng.">
      <div className="divide-y divide-slate-100">
        <div className="pb-3">
          <Toggle label="Aktifkan notifikasi" description="Matikan untuk menyembunyikan semua notifikasi." checked={n.enabled} onChange={(v) => set({ enabled: v })} />
        </div>
        <div className="py-3">
          <Toggle label="Segera Jual" description="Saat sisa shelf-life masuk zona Segera Jual." checked={n.onSegeraJual} onChange={(v) => set({ onSegeraJual: v })} />
        </div>
        <div className="py-3">
          <Toggle label="Tidak Layak Jual" description="Saat sisa shelf-life di bawah batas rawan." checked={n.onTidakLayak} onChange={(v) => set({ onTidakLayak: v })} />
        </div>
        <div className="pt-3">
          <Toggle label="Chamber offline" description="Saat chamber dengan sesi aktif berhenti mengirim data." checked={n.onOffline} onChange={(v) => set({ onOffline: v })} />
        </div>
      </div>
      <p className="text-xs text-slate-500">Perubahan tersimpan otomatis. Notifikasi saat ini hanya tampil di dalam aplikasi (belum ada email atau push).</p>
    </SettingsCard>
  );
}
