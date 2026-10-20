import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { I18nProvider } from '@/context/I18nContext';
import { ToastProvider } from '@/components/common/Toast';

export const metadata = {
  title: 'TOSCHA · Tofu Smart Chamber',
  description: 'Monitoring dan prediksi shelf-life tahu secara real-time',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="font-sans">
        <I18nProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
