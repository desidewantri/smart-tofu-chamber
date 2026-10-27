'use client';

import { useState } from 'react';
import { useI18n } from '@/context/I18nContext';
import { NumberField, SettingsCard } from './SettingsCard';

export default function GeneralSettingsTab({ settings, onSave }) {
  const { t } = useI18n();
  const [app, setApp] = useState({ appName: settings.appName, appDescription: settings.appDescription });
  const [interval, setIntervalMin] = useState(settings.updateIntervalMinutes);
  const [zones, setZones] = useState(settings.zones);
  const [busy, setBusy] = useState('');

  const run = async (key, body) => {
    setBusy(key);
    await onSave(body);
    setBusy('');
  };

  return (
    <div className="space-y-6">
      <SettingsCard title="Informasi Sistem" onSave={() => run('app', app)} saving={busy === 'app'}>
        <div>
          <label className="label" htmlFor="appName">{t('Nama Aplikasi')}</label>
          <input id="appName" className="input" value={app.appName} onChange={(e) => setApp({ ...app, appName: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="appDesc">{t('Deskripsi')}</label>
          <textarea id="appDesc" rows={3} className="input" value={app.appDescription} onChange={(e) => setApp({ ...app, appDescription: e.target.value })} />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Interval Pembaruan"
        description="Perkiraan jeda pengiriman data sensor. Dipakai untuk menentukan kapan chamber dianggap offline (3× interval)."
        onSave={() => run('interval', { updateIntervalMinutes: interval })}
        saving={busy === 'interval'}
      >
        <div>
          <label className="label" htmlFor="interval">{t('Interval')}</label>
          <select id="interval" className="input sm:max-w-xs" value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
            {[1, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} {t('menit')}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            {t('Interval pengiriman sebenarnya diatur di firmware ESP32')} (<code>PUBLISH_INTERVAL_MS</code>).
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Zona Status"
        description="Batas sisa umur simpan untuk status Layak Konsumsi, Segera Konsumsi, dan Tidak Layak Konsumsi."
        onSave={() => run('zones', { zones })}
        saving={busy === 'zones'}
        disabled={!(zones.rawanHours > 0 && zones.segarHours > zones.rawanHours)}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Batas Segar" unit={t('jam')} value={zones.segarHours} onChange={(v) => setZones({ ...zones, segarHours: v })} hint={t('Layak Konsumsi bila sisa > {n} jam', { n: zones.segarHours })} />
          <NumberField label="Batas Rawan" unit={t('jam')} value={zones.rawanHours} onChange={(v) => setZones({ ...zones, rawanHours: v })} hint={t('Segera Konsumsi bila {a}–{b} jam', { a: zones.rawanHours, b: zones.segarHours })} />
          <div>
            <label className="label">{t('Di Bawah')}</label>
            <div className="input bg-slate-50 text-slate-500">&lt; {zones.rawanHours} {t('jam')}</div>
            <p className="mt-1.5 text-xs text-slate-500">{t('Tidak Layak Konsumsi')}</p>
          </div>
        </div>
        {!(zones.rawanHours > 0 && zones.segarHours > zones.rawanHours) && (
          <p className="text-sm text-red-600">{t('Batas segar harus lebih besar dari batas rawan.')}</p>
        )}
      </SettingsCard>
    </div>
  );
}
