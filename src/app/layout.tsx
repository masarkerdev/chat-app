import type { Metadata, Viewport } from 'next';
import { PwaRegister } from '@/components/PwaRegister';
// ফন্ট অ্যাপের সাথেই থাকে — Google Fonts লাগে না, অফলাইনেও কাজ করে
import '@fontsource-variable/anek-bangla/wdth.css';
import '@fontsource/galada/bengali-400.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'দুজনে',
  description: 'শুধু আমাদের দুজনের প্রাইভেট চ্যাট',
  manifest: '/manifest.webmanifest',
  applicationName: 'দুজনে',
  appleWebApp: { capable: true, title: 'দুজনে', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e4e8ef' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1225' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
