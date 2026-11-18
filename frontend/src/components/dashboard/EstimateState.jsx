'use client';

import { useI18n } from '@/context/I18nContext';
import { StatusBadge } from '@/components/common/StatusBadge';
import ShelfLifeTimer from './ShelfLifeTimer';

export default function EstimateState({ session, seconds, textClass = 'text-slate-900' }) {
  const { t } = useI18n();

  let content;
  if (session?.legacy) {
    content = (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-slate-800">{t('Arsip Model Lama')}</p>
          <p className="text-xs text-slate-500">{t('Perkiraan dari model lama tidak ditampilkan.')}</p>
        </div>
        <StatusBadge status="__neutral" className="!px-3 !py-1 !text-[13px]">
          {t('Arsip model lama')}
        </StatusBadge>
      </div>
    );
  } else if (session?.rslDomain === 'OUT_OF_DOMAIN') {
    const elapsedH = Number.isFinite(session?.durasiDetik)
      ? (session.durasiDetik / 3600).toFixed(1)
      : '—';
    content = (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-slate-800">{t('Di Luar Domain')}</p>
          <p className="text-xs text-slate-500">
            {t(`Durasi pemantauan ${elapsedH} jam melewati batas data penelitian (42,9 jam).`)}
          </p>
        </div>
        <StatusBadge status="__neutral" className="!px-3 !py-1 !text-[13px]">
          {t('Di Luar Domain')}
        </StatusBadge>
      </div>
    );
  } else if (session?.sisaDetik === null || seconds === null) {
    content = (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-slate-800">{t('Menyiapkan pemantauan…')}</p>
          <p className="text-xs text-slate-500">{t('Mengumpulkan pembacaan sensor awal.')}</p>
        </div>
        <StatusBadge status="__neutral" className="!px-3 !py-1 !text-[13px]">
          {t('Menyiapkan')}
        </StatusBadge>
      </div>
    );
  } else {
    content = (
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <ShelfLifeTimer seconds={seconds} textClass={textClass} label={t('Perkiraan Sisa Waktu')} />
        <StatusBadge status="Layak Konsumsi" className="!px-3 !py-1 !text-[13px]">
          {t('Memantau')}
        </StatusBadge>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white/80 px-3.5 py-2 ring-1 ring-inset ring-slate-200/70">
      {content}
    </div>
  );
}
