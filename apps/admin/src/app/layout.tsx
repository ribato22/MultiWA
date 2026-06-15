// MultiWA Admin - Root Layout
// apps/admin/src/app/layout.tsx

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
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
      <body className={`${inter.variable} font-sans antialiased bg-background text-foreground min-h-screen`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}