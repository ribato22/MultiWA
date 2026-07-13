'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/HStack';
import { ThemeSwitcherBar } from '@/components/landing/theme-switcher';
import { useI18n } from '@/lib/i18n/provider';

export function LandingHeader() {
  const { t } = useI18n();

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        borderBottom: '1px solid var(--color-border)',
        background: 'color-mix(in srgb, var(--color-background-body) 88%, transparent)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="landing-section-wide" style={{ paddingBlock: '1rem' }}>
        <HStack justify="between" vAlign="center" gap={4}>
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <HStack gap={2} vAlign="center">
              <Image
                src="/logo.png"
                alt={t('app.name')}
                width={40}
                height={40}
                style={{ borderRadius: 12 }}
              />
              <Text type="large" weight="bold">
                {t('app.name')}
              </Text>
            </HStack>
          </Link>

          <HStack gap={2} vAlign="center" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div className="theme-switcher-desktop" style={{ display: 'none' }}>
              <ThemeSwitcherBar />
            </div>
            <Link href="/auth/login" style={{ textDecoration: 'none' }}>
              <Button label={t('landing.login')} variant="ghost" size="sm" />
            </Link>
            <Link href="/auth/register" style={{ textDecoration: 'none' }}>
              <Button label={t('landing.getStarted')} variant="primary" size="sm" />
            </Link>
          </HStack>
        </HStack>
      </div>
      <style jsx>{`
        @media (min-width: 1024px) {
          .theme-switcher-desktop {
            display: block !important;
          }
        }
      `}</style>
    </header>
  );
}
