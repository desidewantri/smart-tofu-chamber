'use client';

import { useState } from 'react';
import { NumberField, SettingsCard } from './SettingsCard';

export default function GeneralSettingsTab({ settings, onSave }) {
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
          <label className="label" htmlFor="appName">Nama Aplikasi</label>
          <input id="appName" className="input" value={app.appName} onChange={(e) => setApp({ ...app, appName: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="appDesc">Deskripsi</label>
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
          <label className="label" htmlFor="interval">Interval</label>
          <select id="interval" className="input sm:max-w-xs" value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
            {[1, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} menit</option>)}
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            Interval pengiriman sebenarnya diatur di firmware ESP32 (<code>PUBLISH_INTERVAL_MS</code>).
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Zona Status"
        description="Batas sisa shelf-life untuk status Layak Jual, Segera Jual, dan Tidak Layak Jual."
        onSave={() => run('zones', { zones })}
        saving={busy === 'zones'}
        disabled={!(zones.rawanHours > 0 && zones.segarHours > zones.rawanHours)}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Batas Segar" unit="jam" value={zones.segarHours} onChange={(v) => setZones({ ...zones, segarHours: v })} hint={`Layak Jual bila sisa > ${zones.segarHours} jam`} />
          <NumberField label="Batas Rawan" unit="jam" value={zones.rawanHours} onChange={(v) => setZones({ ...zones, rawanHours: v })} hint={`Segera Jual bila ${zones.rawanHours}–${zones.segarHours} jam`} />
          <div>
            <label className="label">Di Bawah</label>
            <div className="input bg-slate-50 text-slate-500">&lt; {zones.rawanHours} jam</div>
            <p className="mt-1.5 text-xs text-slate-500">Tidak Layak Jual</p>
          </div>
        </div>
        {!(zones.rawanHours > 0 && zones.segarHours > zones.rawanHours) && (
          <p className="text-sm text-red-600">Batas segar harus lebih besar dari batas rawan.</p>
        )}
      </SettingsCard>
    </div>
  );
}
