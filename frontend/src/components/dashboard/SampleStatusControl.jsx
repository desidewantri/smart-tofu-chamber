'use client';

import { useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/services/api';
import { useI18n } from '@/context/I18nContext';
import { useToast } from '@/components/common/Toast';
import Modal from '@/components/common/Modal';
import { cn } from '@/lib/utils';

const LABEL = {
  UNKNOWN: 'Status sampel belum diinput',
  NOT_SPOILED: 'Sampel belum rusak',
  SPOILED: 'Sampel dilaporkan rusak',
};

export default function SampleStatusControl({ experimentId, sessionId, status = 'UNKNOWN', onChanged }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmSpoiled, setConfirmSpoiled] = useState(false);

  if (!experimentId || !sessionId) return null;

  async function update(next) {
    setBusy(true);
    try {
      await api.updateSampleStatus(experimentId, sessionId, { sampleStatus: next });
      toast(t('Status sampel diperbarui'));
      setConfirmSpoiled(false);
      if (onChanged) onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-slate-50/80 px-3 py-2 ring-1 ring-inset ring-slate-200/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
          {status === 'SPOILED' ? <AlertTriangle className="h-3.5 w-3.5 text-red-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-slate-500" />}
          {t(LABEL[status] || LABEL.UNKNOWN)}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            className={cn('btn-outline !px-2.5 !py-1 !text-[11px]', status === 'NOT_SPOILED' && '!border-emerald-300 !bg-emerald-50 !text-emerald-700')}
            onClick={() => update('NOT_SPOILED')}
            disabled={busy || status === 'NOT_SPOILED'}
          >
            {t('Belum rusak')}
          </button>
          <button
            type="button"
            className={cn('btn-outline !px-2.5 !py-1 !text-[11px]', status === 'SPOILED' && '!border-red-300 !bg-red-50 !text-red-700')}
            onClick={() => setConfirmSpoiled(true)}
            disabled={busy || status === 'SPOILED'}
          >
            {t('Rusak')}
          </button>
        </div>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-slate-500">
        {t('Status ini diisi operator, bukan disimpulkan dari TVOC, suhu, atau kelembapan.')}
      </p>

      <Modal
        open={confirmSpoiled}
        onClose={() => setConfirmSpoiled(false)}
        title="Tandai sampel sebagai rusak?"
        footer={
          <>
            <button className="btn-outline" onClick={() => setConfirmSpoiled(false)}>{t('Batal')}</button>
            <button className="btn-primary" onClick={() => update('SPOILED')} disabled={busy}>
              {busy ? t('Menyimpan…') : t('Ya, sampel rusak')}
            </button>
          </>
        }
      >
        {t('Setelah ditandai rusak, estimasi sisa umur normal tidak ditampilkan untuk chamber ini. Tindakan ini tercatat di riwayat status sampel.')}
      </Modal>
    </div>
  );
}
