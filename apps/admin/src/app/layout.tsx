// MultiWA Admin - Root Layout
// apps/admin/src/app/layout.tsx

import type { Metadata, Viewport } from 'next';
import { Lalezar } from 'next/font/google';
import { Toaster } from '@/components/ui/toaster';
import { I18nProvider } from '@/lib/i18n/provider';
import './globals.css';

// Lalezar supports Latin + Arabic script, covering English, Farsi, and
// Arabic content across the app (see .kiro/specs/app-redesign-i18n-rtl).
const lalezar = Lalezar({
  subsets: ['latin', 'arabic'],
  weight: '400',
  variable: '--font-lalezar',
});

export const metadata: Metadata = {
  title: 'MultiWA - Admin Dashboard',
  description: 'Open Source WhatsApp Business API Gateway',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Dark mode is the primary theme per design-system/multiwa-admin/MASTER.md
    // (Dark Mode OLED). Tailwind's darkMode: "class" wiring is in
    // tailwind.config.js, so the `.dark` CSS variables in globals.css become
    // active here.
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${lalezar.variable} font-sans antialiased bg-background text-foreground min-h-screen`}>
        <I18nProvider>{children}</I18nProvider>
        <Toaster />
      </body>
    </html>
  );
}