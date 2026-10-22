/** Web App Manifest: membuat TOSCHA bisa dipasang di HP/laptop seperti aplikasi (PWA). */
export default function manifest() {
  return {
    id: '/',
    name: 'TOSCHA · Tofu Smart Chamber',
    short_name: 'TOSCHA',
    description: 'Pemantauan dan prediksi umur simpan tahu secara langsung.',
    lang: 'id',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#eef9f6',
    theme_color: '#0f766e',
    categories: ['productivity', 'utilities', 'food'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Dasbor', short_name: 'Dasbor', url: '/dashboard', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Riwayat', short_name: 'Riwayat', url: '/history', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
