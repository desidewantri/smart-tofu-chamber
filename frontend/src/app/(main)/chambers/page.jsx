'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '@/services/api';
import { usePolling, useDebounced } from '@/lib/hooks';
import ChamberTable from '@/components/chambers/ChamberTable';
import Modal from '@/components/common/Modal';
import { ErrorState, Loading } from '@/components/common/States';
import { useToast } from '@/components/common/Toast';

export default function ChambersPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = usePolling(() => api.getChambers(dq), 15000, [dq]);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.createChamber({ name });
      toast(res.message || 'Chamber ditambahkan');
      setOpen(false);
      setName('');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Daftar Chamber</h2>
          <p className="mt-1 text-sm text-slate-500">Semua chamber yang terdaftar beserta status koneksinya.</p>
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Tambah Chamber
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input !pl-10" placeholder="Cari chamber…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {loading && !data ? <Loading /> : error && !data ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : <ChamberTable rows={data} />}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Tambah Chamber"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setOpen(false)}>Batal</button>
            <button form="add-chamber" type="submit" className="btn-primary" disabled={busy || !name.trim()}>Simpan</button>
          </>
        }
      >
        <form id="add-chamber" onSubmit={create}>
          <label htmlFor="cname" className="label">Nama chamber</label>
          <input id="cname" className="input" autoFocus placeholder="mis. Chamber 5" value={name} onChange={(e) => setName(e.target.value)} />
          <p className="mt-2 text-xs text-slate-500">
            ID (CH-00N) dibuat otomatis. Nomor N dipakai perangkat pada topik MQTT <code>smartchamber/sensor/N</code>.
          </p>
        </form>
      </Modal>
    </div>
  );
}
