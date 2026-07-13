'use client';

import { LandingHeader } from '@/components/landing/landing-header';
import { LandingHero } from '@/components/landing/landing-hero';
import {
  ThemeGallerySection,
  ComponentPlaygroundSection,
} from '@/components/landing/theme-switcher';
import { LandingFeatures } from '@/components/landing/landing-features';
import { LandingStats } from '@/components/landing/landing-stats';
import { LandingIntegrations } from '@/components/landing/landing-integrations';
import { LandingPricing } from '@/components/landing/landing-pricing';
import { LandingFaq } from '@/components/landing/landing-faq';
import { LandingCta } from '@/components/landing/landing-cta';
import { LandingFooter } from '@/components/landing/landing-footer';

export function LandingPage() {
  return (
    <>
      <LandingHeader />
      <main>
        <LandingHero />
        <LandingStats />
        <ThemeGallerySection />
        <LandingFeatures />
        <ComponentPlaygroundSection />
        <LandingIntegrations />
        <LandingPricing />
        <LandingFaq />
        <LandingCta />
      </main>
      <LandingFooter />
    </>
  );
}
