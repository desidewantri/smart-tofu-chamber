'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, BookOpen, Boxes, History, LayoutDashboard, Settings, X } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { cn } from '@/lib/utils';
import { LogoMark, TofuIllustration } from '@/components/common/Logo';

export const NAV = [
  { href: '/dashboard', label: 'Dasbor', icon: LayoutDashboard },
  { href: '/chambers', label: 'Chamber', icon: Boxes },
  { href: '/analysis', label: 'Analisis', icon: BarChart3 },
  { href: '/history', label: 'Riwayat', icon: History },
  { href: '/guide', label: 'Panduan', icon: BookOpen },
  { href: '/settings', label: 'Pengaturan', icon: Settings },
];

export default function Sidebar({ open, onClose }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200/70 bg-white transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="relative flex flex-col items-center px-5 pb-4 pt-9">
          <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 lg:hidden" aria-label={t('Tutup menu')}>
            <X className="h-5 w-5" />
          </button>
          <Link href="/dashboard" className="flex flex-col items-center gap-3 text-center">
            <LogoMark className="h-20 w-20 shadow-md" rounded="rounded-3xl" />
            <span className="text-lg font-extrabold leading-tight tracking-tight text-slate-900">Smart Tofu Chamber</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition',
                  active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {t(label)}
              </Link>
            );
          })}
        </nav>

        <div className="hidden px-4 pb-5 [@media(min-height:820px)]:block">
          <TofuIllustration className="w-full" />
        </div>
      </aside>
    </>
  );
}
