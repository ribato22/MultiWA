'use client';

import Link from 'next/link';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useI18n } from '@/lib/i18n/provider';

const plans = [
  {
    nameKey: 'landing.pricing.free.name' as const,
    priceKey: 'landing.pricing.free.price' as const,
    descKey: 'landing.pricing.free.desc' as const,
    featuresKey: 'landing.pricing.free.features' as const,
    ctaKey: 'landing.pricing.free.cta' as const,
    highlighted: false,
  },
  {
    nameKey: 'landing.pricing.pro.name' as const,
    priceKey: 'landing.pricing.pro.price' as const,
    descKey: 'landing.pricing.pro.desc' as const,
    featuresKey: 'landing.pricing.pro.features' as const,
    ctaKey: 'landing.pricing.pro.cta' as const,
    highlighted: true,
  },
  {
    nameKey: 'landing.pricing.enterprise.name' as const,
    priceKey: 'landing.pricing.enterprise.price' as const,
    descKey: 'landing.pricing.enterprise.desc' as const,
    featuresKey: 'landing.pricing.enterprise.features' as const,
    ctaKey: 'landing.pricing.enterprise.cta' as const,
    highlighted: false,
  },
];

export function LandingPricing() {
  const { t } = useI18n();

  return (
    <section id="pricing" className="landing-section" style={{ paddingBlock: '4rem' }}>
      <VStack gap={6}>
        <VStack gap={2} hAlign="center" style={{ textAlign: 'center' }}>
          <Text type="label" color="accent" weight="semibold">
            {t('landing.pricing.eyebrow')}
          </Text>
          <Heading level={2} justify="center">
            {t('landing.pricing.title')}
          </Heading>
          <Text type="body" color="secondary" display="block" style={{ maxWidth: 520 }}>
            {t('landing.pricing.subtitle')}
          </Text>
        </VStack>

        <Grid columns={{ minWidth: 260, max: 3 }} gap={4}>
          {plans.map((plan) => (
            <Card
              key={plan.nameKey}
              padding={5}
              variant={plan.highlighted ? 'blue' : 'default'}
            >
              <VStack gap={4}>
                <VStack gap={1}>
                  <Heading level={3}>{t(plan.nameKey)}</Heading>
                  <Heading level={2}>{t(plan.priceKey)}</Heading>
                  <Text type="supporting" color="secondary">
                    {t(plan.descKey)}
                  </Text>
                </VStack>
                <Divider />
                <Text type="body" color="secondary" display="block">
                  {t(plan.featuresKey)}
                </Text>
                <div style={{ marginTop: 'auto' }}>
                  <Link href="/auth/register" style={{ textDecoration: 'none' }}>
                    <Button
                      label={t(plan.ctaKey)}
                      variant={plan.highlighted ? 'primary' : 'secondary'}
                      size="md"
                    />
                  </Link>
                </div>
              </VStack>
            </Card>
          ))}
        </Grid>
      </VStack>
    </section>
  );
}
