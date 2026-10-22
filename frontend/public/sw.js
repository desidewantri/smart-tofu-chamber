/*
 * Service worker TOSCHA (PWA).
 * - Aset statis Next.js (/_next/static, ikon) disimpan di cache agar aplikasi cepat terbuka.
 * - Halaman diambil dari jaringan dulu; bila offline, tampilkan halaman cadangan /offline.html.
 * - Data API (sensor, sesi, prediksi) TIDAK disimpan di cache: data harus selalu terbaru.
 * Naikkan VERSION setiap kali isi file ini diubah.
 */
const VERSION = 'toscha-v1';
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Panggilan ke backend/API (domain lain atau /api): selalu langsung ke jaringan.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  // Aset statis berversi: ambil dari cache dulu.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Navigasi halaman: jaringan dulu, halaman offline bila gagal.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
  }
});
