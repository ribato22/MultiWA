'use client';

import Link from 'next/link';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { ThemeSwitcher } from '@/components/landing/theme-switcher';
import { useI18n } from '@/lib/i18n/provider';

export function LandingFooter() {
  const { t } = useI18n();

  return (
    <footer style={{ borderTop: '1px solid var(--color-border)', marginTop: '2rem' }}>
      <div className="landing-section-wide" style={{ paddingBlock: '3rem' }}>
        <VStack gap={6}>
          <div className="theme-switcher-mobile">
            <ThemeSwitcher compact />
          </div>
          <Divider />
          <HStack justify="between" vAlign="center" style={{ flexWrap: 'wrap', gap: 16 }}>
            <Text type="supporting" color="secondary">
              {t('landing.footer')}
            </Text>
            <HStack gap={2}>
              <a
                href="https://ribato22.github.io/MultiWA/docs/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}
              >
                <Button label={t('landing.footer.docs')} variant="ghost" size="sm" />
              </a>
              <a
                href="https://github.com/ribato22/MultiWA"
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}
              >
                <Button label={t('landing.footer.github')} variant="ghost" size="sm" />
              </a>
              <Link href="/auth/login" style={{ textDecoration: 'none' }}>
                <Button label={t('landing.login')} variant="ghost" size="sm" />
              </Link>
            </HStack>
          </HStack>
        </VStack>
      </div>
      <style jsx>{`
        .theme-switcher-mobile {
          display: block;
        }
        @media (min-width: 1024px) {
          .theme-switcher-mobile {
            display: none;
          }
        }
      `}</style>
    </footer>
  );
}
