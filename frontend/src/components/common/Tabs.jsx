'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/context/I18nContext';

/** tabs: [{ id, label }] */
export default function Tabs({ tabs, active, onChange }) {
  const { t } = useI18n();
  return (
    <div className="thin-scroll flex gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition',
            active === tab.id ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          )}
        >
          {t(tab.label)}
        </button>
      ))}
    </div>
  );
}
