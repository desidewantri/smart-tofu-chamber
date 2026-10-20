'use client';

import Link from 'next/link';
import { History, LineChart } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { classifyShelfLife } from '@/lib/utils';
import { getLocale } from '@/lib/locale';

function greetingKey(hour) {
  if (hour >= 4 && hour < 11) return 'Selamat pagi';
  if (hour >= 11 && hour < 15) return 'Selamat siang';
  if (hour >= 15 && hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/** Ilustrasi tahu samar di sisi kanan kartu sapaan. */
function Cubes() {
  const cube = (x, y, s) => (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M0 14 22 2l22 12v22L22 48 0 36V14Z" fill="#fefce8" stroke="#99f6e4" />
      <path d="M0 14l22 12 22-12M22 26v22" stroke="#99f6e4" fill="none" />
      <path d="M0 14 22 2l22 12-22 12L0 14Z" fill="#fff" />
    </g>
  );
  return (
    <svg viewBox="0 0 320 150" className="hidden w-28 shrink-0 opacity-90 xl:block" aria-hidden="true">
      {cube(40, 60, 1.6)}
      {cube(120, 40, 1.9)}
      {cube(210, 70, 1.4)}
      <ellipse cx="160" cy="142" rx="140" ry="8" fill="#0f766e" fillOpacity=".09" />
    </svg>
  );
}

/** Kartu sapaan di bawah kartu chamber: tanggal, sapaan, dan ringkasan kondisi hari ini. */
export default function GreetingCard({ active, idle, zones, fetchedAt }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const now = new Date(fetchedAt || Date.now());

  const count = { segera: 0, tidak: 0 };
  active.forEach(({ session }) => {
    const st = classifyShelfLife((session?.sisaDetik ?? 0) / 3600, zones);
    if (st === 'Segera Jual') count.segera += 1;
    if (st === 'Tidak Layak Jual') count.tidak += 1;
  });
  const chambers = [...active, ...idle].map((x) => x.chamber).filter((c) => c.enabled);
  const offline = chambers.filter((c) => !c.connected).length;

  const parts = [];
  if (count.segera) parts.push(t('{n} chamber perlu segera dijual', { n: count.segera }));
  if (count.tidak) parts.push(t('{n} chamber sudah tidak layak jual', { n: count.tidak }));
  let summary;
  if (!active.length) summary = t('Belum ada tahu yang sedang disimpan.');
  else if (!parts.length) summary = t('Semua tahu di chamber masih layak jual.');
  else summary = `${t('Hari ini')} ${parts.join(` ${t('dan')} `)}.`;
  const sensor = offline ? t('{n} sensor terputus.', { n: offline }) : t('Semua sensor terhubung.');

  const date = now.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });

  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-slate-200/70 border-l-[5px] border-l-brand-600 bg-white px-5 py-3 shadow-card">
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-brand-600">
          {date} · {time}
        </p>
        <h2 className="mt-0.5 text-[17px] font-extrabold text-brand-900">
          {t(greetingKey(now.getHours()))}, {user?.name || t('Pengguna')} 👋
        </h2>
        <p className="mt-0.5 text-[13px] text-slate-600">
          {summary} {sensor}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
          <Link href="/analysis" className="btn-primary !px-3 !py-1.5 !text-[13px]">
            <LineChart className="h-4 w-4" /> {t('Lihat Analisis')}
          </Link>
          <Link href="/history" className="btn-outline !px-3 !py-1.5 !text-[13px]">
            <History className="h-4 w-4" /> {t('Riwayat Sesi')}
          </Link>
      </div>
      <Cubes />
    </section>
  );
}
