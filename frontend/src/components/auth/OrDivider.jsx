'use client';

import { useI18n } from '@/context/I18nContext';

export default function OrDivider() {
  const { t } = useI18n();
  return (
    <div className="my-4 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-slate-400">
      <span className="h-px flex-1 bg-slate-200" /> {t('atau')} <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

