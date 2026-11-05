'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import { Loading } from '@/components/common/States';

export default function MainLayout({ children }) {
  const { user, ready } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  if (!ready || !user) return <Loading label={t('Memeriksa sesi masuk…')} />;

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[70] focus:rounded-xl focus:bg-white focus:px-3.5 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-800 focus:shadow-pop"
      >
        {t('Lewati ke konten utama')}
      </a>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-[17rem]">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main id="main-content" className="mx-auto w-full max-w-[1400px] px-4 pb-5 pt-1 sm:px-7 [@media(max-height:700px)]:pb-1">{children}</main>
      </div>
    </div>
  );
}
