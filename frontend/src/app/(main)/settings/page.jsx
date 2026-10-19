'use client';

import { useState } from 'react';
import { api } from '@/services/api';
import { usePolling } from '@/lib/hooks';
import Tabs from '@/components/common/Tabs';
import { ErrorState, Loading } from '@/components/common/States';
import { useToast } from '@/components/common/Toast';
import GeneralSettingsTab from '@/components/settings/GeneralSettingsTab';
import NotificationSettingsTab from '@/components/settings/NotificationSettingsTab';
import ThresholdSettingsTab from '@/components/settings/ThresholdSettingsTab';
import AccountSettingsTab from '@/components/settings/AccountSettingsTab';

const TABS = [
  { id: 'umum', label: 'Umum' },
  { id: 'notifikasi', label: 'Notifikasi' },
  { id: 'batas', label: 'Batas Parameter' },
  { id: 'akun', label: 'Akun' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState('umum');
  const { toast } = useToast();
  const { data, error, loading, reload } = usePolling(() => api.getSettings(), 0, []);
  const [override, setOverride] = useState(null);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const settings = override || data;

  async function save(body) {
    try {
      const res = await api.updateSettings(body);
      setOverride(res.data);
      toast(res.message || 'Pengaturan disimpan');
      return true;
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div key={tab} className="animate-fade-in">
        {tab === 'umum' && <GeneralSettingsTab settings={settings} onSave={save} />}
        {tab === 'notifikasi' && <NotificationSettingsTab settings={settings} onSave={save} />}
        {tab === 'batas' && <ThresholdSettingsTab settings={settings} onSave={save} />}
        {tab === 'akun' && <AccountSettingsTab />}
      </div>
    </div>
  );
}
