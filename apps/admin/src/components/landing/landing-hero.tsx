'use client';

import Link from 'next/link';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { useI18n } from '@/lib/i18n/provider';

export function LandingHero() {
  const { t } = useI18n();

  return (
    <section className="landing-section" style={{ paddingBlock: '5rem 3rem' }}>
      <VStack gap={6} hAlign="center" style={{ textAlign: 'center' }}>
        <Badge label={t('landing.badge')} variant="green" />

        <VStack gap={3} hAlign="center">
          <Heading level={1} type="display-1" justify="center">
            {t('landing.heroTitle1')}
            <br />
            <span style={{ color: 'var(--color-text-accent)' }}>
              {t('landing.heroTitle2')}
            </span>
          </Heading>
          <Text type="large" color="secondary" display="block" style={{ maxWidth: 640 }}>
            {t('landing.heroSubtitle')}
          </Text>
        </VStack>

        <HStack gap={3} vAlign="center" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/auth/register" style={{ textDecoration: 'none' }}>
            <Button label={t('landing.startTrial')} variant="primary" size="lg" />
          </Link>
          <a
            href="https://github.com/ribato22/MultiWA"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <Button label={t('landing.viewGithub')} variant="secondary" size="lg" />
          </a>
        </HStack>
      </VStack>
    </section>
  );
}
