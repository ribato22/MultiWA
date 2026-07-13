'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useI18n } from '@/lib/i18n/provider';
import type { MessageKey } from '@/lib/i18n/messages';

const featureKeys: {
  titleKey: MessageKey;
  descKey: MessageKey;
  variant: 'blue' | 'purple' | 'teal' | 'orange' | 'pink' | 'green';
}[] = [
  {
    titleKey: 'landing.feature.multiEngine.title',
    descKey: 'landing.feature.multiEngine.desc',
    variant: 'green',
  },
  {
    titleKey: 'landing.feature.broadcast.title',
    descKey: 'landing.feature.broadcast.desc',
    variant: 'purple',
  },
  {
    titleKey: 'landing.feature.automation.title',
    descKey: 'landing.feature.automation.desc',
    variant: 'blue',
  },
  {
    titleKey: 'landing.feature.multiTenant.title',
    descKey: 'landing.feature.multiTenant.desc',
    variant: 'orange',
  },
  {
    titleKey: 'landing.feature.webhooks.title',
    descKey: 'landing.feature.webhooks.desc',
    variant: 'pink',
  },
  {
    titleKey: 'landing.feature.analytics.title',
    descKey: 'landing.feature.analytics.desc',
    variant: 'teal',
  },
];

export function LandingFeatures() {
  const { t } = useI18n();

  return (
    <section id="features" className="landing-section" style={{ paddingBlock: '4rem' }}>
      <VStack gap={6}>
        <VStack gap={2} hAlign="center" style={{ textAlign: 'center' }}>
          <Text type="label" color="accent" weight="semibold">
            {t('landing.features.eyebrow')}
          </Text>
          <Heading level={2} justify="center">
            {t('landing.features.title')}
          </Heading>
          <Text type="body" color="secondary" display="block" style={{ maxWidth: 560 }}>
            {t('landing.features.subtitle')}
          </Text>
        </VStack>

        <Grid columns={{ minWidth: 280, max: 3 }} gap={4}>
          {featureKeys.map((feature) => (
            <Card key={feature.titleKey} variant={feature.variant} padding={5}>
              <VStack gap={3}>
                <Badge label={t(feature.titleKey)} variant={feature.variant} />
                <Heading level={3}>{t(feature.titleKey)}</Heading>
                <Text type="body" color="secondary">
                  {t(feature.descKey)}
                </Text>
              </VStack>
            </Card>
          ))}
        </Grid>
      </VStack>
    </section>
  );
}
