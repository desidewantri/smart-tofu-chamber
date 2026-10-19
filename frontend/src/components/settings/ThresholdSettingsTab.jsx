'use client';

import { useState } from 'react';
import { useI18n } from '@/context/I18nContext';
import { NumberField, SettingsCard } from './SettingsCard';

const PARAMS = [
  { key: 'tvoc', label: 'TVOC', unit: 'ppb' },
  { key: 'suhu', label: 'Suhu', unit: '°C' },
  { key: 'rh', label: 'Kelembapan', unit: '%' },
];

export default function ThresholdSettingsTab({ settings, onSave }) {
  const { t } = useI18n();
  const [th, setTh] = useState(settings.thresholds);
  const [biz, setBiz] = useState(settings.business);
  const [busy, setBusy] = useState('');

  const valid = PARAMS.every(({ key }) => Number(th[key].perhatian) > Number(th[key].aman));
  const run = async (key, body) => {
    setBusy(key);
    await onSave(body);
    setBusy('');
  };

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Batas Parameter Sensor"
        description="Menentukan label Aman / Perhatian / Bahaya pada kartu sensor. Nilai awal ini adalah titik mulai, bukan ambang ilmiah; sesuaikan setelah ada data uji lab."
        onSave={() => run('th', { thresholds: th })}
        saving={busy === 'th'}
        disabled={!valid}
      >
        {PARAMS.map(({ key, label, unit }) => (
          <div key={key} className="rounded-xl border border-slate-100 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">{t(label)}</p>
            <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Aman sampai" unit={unit} step={key === 'tvoc' ? 10 : 0.5} value={th[key].aman} onChange={(v) => setTh({ ...th, [key]: { ...th[key], aman: v } })} />
            <NumberField label="Perhatian sampai" unit={unit} step={key === 'tvoc' ? 10 : 0.5} value={th[key].perhatian} onChange={(v) => setTh({ ...th, [key]: { ...th[key], perhatian: v } })} hint="Di atas nilai ini = Bahaya" />
            </div>
          </div>
        ))}
        {!valid && <p className="text-sm text-red-600">{t('Batas "Perhatian" harus lebih besar dari batas "Aman".')}</p>}
      </SettingsCard>

      <SettingsCard
        title="Asumsi Biaya dan Manfaat"
        description="Dipakai tab Biaya dan Manfaat di halaman Analisis. Isi dengan angka dari produsen tahu yang sebenarnya."
        onSave={() => run('biz', { business: biz })}
        saving={busy === 'biz'}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Berat tahu per sesi" unit="kg" value={biz.batchKg} onChange={(v) => setBiz({ ...biz, batchKg: v })} />
          <NumberField label="Harga jual" unit="Rp/kg" step={500} value={biz.pricePerKg} onChange={(v) => setBiz({ ...biz, pricePerKg: v })} />
          <NumberField label="Diskon saat Segera Jual" unit="0–1" step={0.05} value={biz.discountSegera} onChange={(v) => setBiz({ ...biz, discountSegera: v })} hint="0,3 = diskon 30%" />
          <NumberField label="Tahu terbuang tanpa sistem" unit="0–1" step={0.05} value={biz.lossRateWithoutSystem} onChange={(v) => setBiz({ ...biz, lossRateWithoutSystem: v })} hint="Asumsi pembanding" />
          <NumberField label="Biaya operasional per sesi" unit="Rp" step={500} value={biz.operationalCostPerSession} onChange={(v) => setBiz({ ...biz, operationalCostPerSession: v })} />
        </div>
      </SettingsCard>
    </div>
  );
}
