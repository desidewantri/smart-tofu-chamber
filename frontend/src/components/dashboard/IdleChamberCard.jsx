'use client';

import Link from 'next/link';
import { Boxes, Hourglass } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { cn, formatRelative } from '@/lib/utils';

/** Kartu untuk chamber yang belum punya sesi aktif, agar dasbor selalu menampilkan 2 kartu. */
export default function IdleChamberCard({ chamber }) {
  const { t } = useI18n();
  return (
    <article className="flex flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-card">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Boxes className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold leading-tight text-slate-900">{chamber.name}</h2>
            <p className="truncate text-xs text-slate-500">{t('Belum ada sesi aktif')}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('flex items-center justify-end gap-1.5 text-xs font-semibold', chamber.connected ? 'text-emerald-600' : 'text-slate-400')}>
            <span className={cn('h-2 w-2 rounded-full', chamber.connected ? 'bg-emerald-500' : 'bg-slate-400')} />
            {chamber.connected ? t('Terhubung') : t('Terputus')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('Diperbarui')} {formatRelative(chamber.lastSeenAt).toLowerCase()}
          </p>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl bg-slate-50 px-6 py-10 text-center ring-1 ring-inset ring-slate-200/70">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-inset ring-slate-200"><Hourglass className="h-6 w-6" /></span>
        <p className="text-sm font-semibold text-slate-700">{t('Menunggu data sensor pertama')}</p>
        <p className="max-w-xs text-xs text-slate-500">{t('Sesi baru dibuat otomatis begitu sensor mengirim data tahu berikutnya.')}</p>
      </div>

      <footer className="flex justify-end border-t border-slate-200/70 pt-3">
        <Link href={`/chambers/${chamber.chamberId}`} className="btn-outline !px-3 !py-1.5 !text-xs">{t('Lihat Detail')}</Link>
      </footer>
    </article>
  );
}
