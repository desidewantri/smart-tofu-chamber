'use client';

import { useState } from 'react';
import { api } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/common/Toast';
import { SettingsCard } from './SettingsCard';

export default function AccountSettingsTab() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
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
    if (pw.newPassword !== pw.confirm) return toast('Konfirmasi password tidak sama', 'error');
    setBusy('pw');
    try {
      const res = await api.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      toast(res.message || 'Password diganti');
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
            <label className="label" htmlFor="pname">Nama</label>
            <input id="pname" className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="pemail">Email</label>
            <input id="pemail" type="email" className="input" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Ganti Password"
        onSave={savePassword}
        saving={busy === 'pw'}
        saveLabel="Ganti Password"
        disabled={!pw.currentPassword || pw.newPassword.length < 6}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="cur">Password lama</label>
            <input id="cur" type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="new">Password baru</label>
            <input id="new" type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <p className="mt-1.5 text-xs text-slate-500">Minimal 6 karakter.</p>
          </div>
          <div>
            <label className="label" htmlFor="conf">Ulangi password baru</label>
            <input id="conf" type="password" autoComplete="new-password" className="input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
