import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { I18nProvider } from '@/context/I18nContext';
import { ToastProvider } from '@/components/common/Toast';
import PwaRegister from '@/components/common/PwaRegister';

export const metadata = {
  title: 'TOSCHA · Tofu Smart Chamber',
  description: 'Pemantauan dan prediksi umur simpan tahu secara langsung.',
  applicationName: 'TOSCHA',
  appleWebApp: { capable: true, title: 'TOSCHA', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  themeColor: '#0f766e',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="font-sans">
        <I18nProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
            <PwaRegister />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
