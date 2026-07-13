'use client';

import Link from 'next/link';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { useLandingTheme } from '@/hooks/use-landing-theme';

interface AstryxProvidersProps {
  children: React.ReactNode;
}

export function AstryxProviders({ children }: AstryxProvidersProps) {
  const { activeTheme, colorMode } = useLandingTheme();

  return (
    <Theme theme={activeTheme.theme} mode={colorMode}>
      <LinkProvider component={Link}>{children}</LinkProvider>
    </Theme>
  );
}
