'use client';

import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useI18n } from '@/lib/i18n/provider';

const statKeys = [
  { value: '10K+', labelKey: 'landing.stats.messages' as const },
  { value: '99.9%', labelKey: 'landing.stats.uptime' as const },
  { value: '2', labelKey: 'landing.stats.engines' as const },
  { value: 'MIT', labelKey: 'landing.stats.license' as const },
];

export function LandingStats() {
  const { t } = useI18n();

  return (
    <section className="landing-section" style={{ paddingBlock: '2rem 4rem' }}>
      <Grid columns={{ minWidth: 160, max: 4 }} gap={3}>
        {statKeys.map((stat) => (
          <Card key={stat.labelKey} padding={4} variant="muted">
            <VStack gap={1} hAlign="center" style={{ textAlign: 'center' }}>
              <Heading level={2} type="display-3">
                {stat.value}
              </Heading>
              <Text type="label" color="secondary">
                {t(stat.labelKey)}
              </Text>
            </VStack>
          </Card>
        ))}
      </Grid>
    </section>
  );
}
