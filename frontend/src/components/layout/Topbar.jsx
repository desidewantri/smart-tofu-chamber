'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Bell, ChevronDown, Info, LogOut, Menu, Settings, XOctagon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { NAV } from '@/components/layout/Sidebar';
import { useI18n } from '@/context/I18nContext';
import LanguageSwitch from '@/components/common/LanguageSwitch';
import { usePolling } from '@/lib/hooks';
import { api } from '@/services/api';
import { cn, formatRelative } from '@/lib/utils';

const TITLES = {
  '/dashboard': ['Dasbor', 'Pantau kondisi dan sisa umur tahu secara langsung'],
  '/chambers': ['Chamber', 'Pantau Chamber 1 dan Chamber 2'],
  '/analysis': ['Analisis', 'Analisis kondisi, biaya dan manfaat, serta tren musiman'],
  '/history': ['Riwayat', 'Riwayat sesi penyimpanan tahu'],
  '/guide': ['Panduan', 'Pelajari istilah dan cara memakai aplikasi'],
  '/settings': ['Pengaturan', 'Atur preferensi dan parameter sistem'],
};

function useClickOutside(ref, handler) {
  useEffect(() => {
    const fn = (e) => ref.current && !ref.current.contains(e.target) && handler();
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [ref, handler]);
}

const LEVEL = {
  danger: { icon: XOctagon, cls: 'bg-red-50 text-red-600' },
  warning: { icon: AlertTriangle, cls: 'bg-amber-50 text-amber-600' },
  info: { icon: Info, cls: 'bg-sky-50 text-sky-600' },
};

export default function Topbar({ onMenu }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const bellRef = useRef(null);
  const userRef = useRef(null);
  useClickOutside(bellRef, () => setBellOpen(false));
  useClickOutside(userRef, () => setUserOpen(false));

  const { data: notes } = usePolling(() => api.getNotifications(), 30000, []);
  const key = Object.keys(TITLES).find((k) => pathname === k || pathname.startsWith(`${k}/`));
  const [title, subtitle] = TITLES[key] || ['TOSCHA', ''];
  const Icon = NAV.find((n) => n.href === key)?.icon;
  const count = notes?.length || 0;

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 bg-[#eef9f6]/80 px-4 py-3 backdrop-blur sm:px-7 [@media(max-height:700px)]:py-2">
      <button onClick={onMenu} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label={t('Buka menu')}>
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4 lg:justify-center">
        {Icon && (
          <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_8px_18px_rgba(15,118,110,0.28)] sm:flex">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold leading-tight tracking-tight text-brand-900 lg:text-2xl">{t(title)}</h1>
          <p className="hidden truncate text-[13px] text-slate-500 sm:block">{t(subtitle)}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <LanguageSwitch className="hidden bg-white shadow-sm sm:inline-flex" />
        {/* Notifikasi */}
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setBellOpen((o) => !o)}
            className="relative rounded-xl p-2.5 text-slate-600 hover:bg-slate-100"
            aria-label={t('Notifikasi')}
          >
            <Bell className="h-5 w-5" />
            {count > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
          </button>
          {bellOpen && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">{t('Notifikasi')} {count > 0 && `(${count})`}</div>
              <div className="max-h-80 overflow-y-auto">
                {count === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">{t('Tidak ada notifikasi.')}</p>}
                {(notes || []).map((n) => {
                  const L = LEVEL[n.level] || LEVEL.info;
                  return (
                    <Link
                      key={n.id}
                      href={`/chambers/${n.chamberId}`}
                      onClick={() => setBellOpen(false)}
                      className="flex gap-3 border-b border-slate-50 px-4 py-3 last:border-0 hover:bg-slate-50"
                    >
                      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', L.cls)}>
                        <L.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">{t(n.title)}</span>
                        <span className="block text-xs text-slate-500">{t(n.message)}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">{formatRelative(n.time)}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Akun */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => setUserOpen((o) => !o)}
            className="flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2.5 hover:bg-slate-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {(user?.name || 'U').slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden text-sm font-semibold text-slate-700 sm:block">{user?.name || t('Pengguna')}</span>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
          {userOpen && (
            <div className="absolute right-0 mt-2 w-56 animate-fade-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="truncate text-sm font-semibold">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>
              <div className="border-b border-slate-100 px-4 py-2.5 sm:hidden"><LanguageSwitch /></div>
              <Link href="/settings" onClick={() => setUserOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                <Settings className="h-4 w-4" /> {t('Pengaturan')}
              </Link>
              <button
                onClick={() => {
                  logout();
                  router.replace('/login');
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" /> {t('Keluar')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
