'use client';

import { Badge } from '@astryxdesign/core/Badge';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { useI18n } from '@/lib/i18n/provider';

const integrations = [
  'n8n',
  'Chatwoot',
  'Webhooks',
  'REST API',
  'WordPress',
  'Baileys',
  'whatsapp-web.js',
  'Socket.IO',
] as const;

const badgeVariants = [
  'blue',
  'purple',
  'teal',
  'orange',
  'pink',
  'green',
  'cyan',
  'yellow',
] as const;

export function LandingIntegrations() {
  const { t } = useI18n();

  return (
    <section id="integrations" className="landing-section" style={{ paddingBlock: '4rem' }}>
      <VStack gap={5} hAlign="center" style={{ textAlign: 'center' }}>
        <VStack gap={2}>
          <Text type="label" color="accent" weight="semibold">
            {t('landing.integrations.eyebrow')}
          </Text>
          <Heading level={2} justify="center">
            {t('landing.integrations.title')}
          </Heading>
          <Text type="body" color="secondary" display="block" style={{ maxWidth: 520 }}>
            {t('landing.integrations.subtitle')}
          </Text>
        </VStack>
        <HStack gap={2} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {integrations.map((name, index) => (
            <Badge
              key={name}
              label={name}
              variant={badgeVariants[index % badgeVariants.length]}
            />
          ))}
        </HStack>
      </VStack>
    </section>
  );
}
