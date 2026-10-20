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
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-gradient-to-b from-brand-800 to-brand-900 shadow-[0_20px_40px_rgba(17,94,89,0.25)] transition-transform lg:inset-y-4 lg:left-4 lg:translate-x-0 lg:rounded-[28px]',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="relative flex flex-col items-center px-5 pb-3 pt-7">
          <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 text-brand-100 hover:bg-white/10 lg:hidden" aria-label={t('Tutup menu')}>
            <X className="h-5 w-5" />
          </button>
          <Link href="/dashboard" className="flex flex-col items-center gap-2.5 text-center">
            <LogoMark className="h-16 w-16 shadow-md ring-4 ring-white/10" rounded="rounded-[20px]" />
            <span className="flex flex-col items-center"><span className="text-xl font-extrabold tracking-[0.12em] text-white">TOSCHA</span><span className="text-[11px] font-medium text-brand-100/80">Tofu Smart Chamber</span></span>
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
                  'flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-semibold transition',
                  active ? 'bg-white text-brand-800 shadow-sm' : 'text-brand-100/90 hover:bg-white/10 hover:text-white'
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {t(label)}
              </Link>
            );
          })}
        </nav>

        <div className="hidden px-6 pb-5 [@media(min-height:700px)]:block">
          <TofuIllustration className="w-full" />
        </div>
      </aside>
    </>
  );
}
