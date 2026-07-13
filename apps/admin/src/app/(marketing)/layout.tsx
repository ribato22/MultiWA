import { Suspense, type ReactNode } from 'react';
import { LandingThemeProvider } from '@/components/landing/landing-theme-provider';
import { AstryxProviders } from '@/components/landing/astryx-providers';
import '../astryx.css';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <LandingThemeProvider>
        <AstryxProviders>
          <div className="landing-root">{children}</div>
        </AstryxProviders>
      </LandingThemeProvider>
    </Suspense>
  );
}
