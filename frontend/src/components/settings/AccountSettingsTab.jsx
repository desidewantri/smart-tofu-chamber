'use client';

import { useState } from 'react';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/common/Toast';
import { useI18n } from '@/context/I18nContext';
import { SettingsCard } from './SettingsCard';

export default function AccountSettingsTab() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState('');

  async function saveProfile() {
    setBusy('profile');
    try {
      const res = await api.updateProfile(profile);
      setUser(res.data.user);
      toast(res.message || 'Profil diperbarui');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function savePassword() {
    if (pw.newPassword !== pw.confirm) return toast('Konfirmasi kata sandi tidak sama', 'error');
    setBusy('pw');
    try {
      const res = await api.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      toast(res.message || 'Kata sandi diganti');
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
    return undefined;
  }

  return (
    <div className="space-y-6">
      <SettingsCard title="Profil" onSave={saveProfile} saving={busy === 'profile'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pname">{t('Nama')}</label>
            <input id="pname" className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pemail">{t('Email')}</label>
            <input id="pemail" type="email" className="input" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Ganti Kata Sandi"
        onSave={savePassword}
        saving={busy === 'pw'}
        saveLabel="Ganti Kata Sandi"
        disabled={!pw.currentPassword || pw.newPassword.length < 6}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="cur">{t('Kata sandi lama')}</label>
            <input id="cur" type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="new">{t('Kata sandi baru')}</label>
            <input id="new" type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <p className="mt-1.5 text-xs text-slate-500">{t('Minimal 6 karakter.')}</p>
          </div>
          <div>
            <label className="label" htmlFor="conf">{t('Ulangi kata sandi baru')}</label>
            <input id="conf" type="password" autoComplete="new-password" className="input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
