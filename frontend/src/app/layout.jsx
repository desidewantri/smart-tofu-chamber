import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/common/Toast';

export const metadata = {
  title: 'Smart Tofu Chamber',
  description: 'Monitoring dan prediksi shelf-life tahu secara real-time',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="font-sans">
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
