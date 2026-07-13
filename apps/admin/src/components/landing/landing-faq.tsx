'use client';

import { Card } from '@astryxdesign/core/Card';
import { Collapsible, CollapsibleGroup } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useI18n } from '@/lib/i18n/provider';

const faqItems = [
  { q: 'landing.faq.q1' as const, a: 'landing.faq.a1' as const, value: 'q1' },
  { q: 'landing.faq.q2' as const, a: 'landing.faq.a2' as const, value: 'q2' },
  { q: 'landing.faq.q3' as const, a: 'landing.faq.a3' as const, value: 'q3' },
  { q: 'landing.faq.q4' as const, a: 'landing.faq.a4' as const, value: 'q4' },
  { q: 'landing.faq.q5' as const, a: 'landing.faq.a5' as const, value: 'q5' },
];

export function LandingFaq() {
  const { t } = useI18n();

  return (
    <section id="faq" className="landing-section" style={{ paddingBlock: '4rem' }}>
      <VStack gap={6}>
        <VStack gap={2} hAlign="center" style={{ textAlign: 'center' }}>
          <Text type="label" color="accent" weight="semibold">
            {t('landing.faq.eyebrow')}
          </Text>
          <Heading level={2} justify="center">
            {t('landing.faq.title')}
          </Heading>
        </VStack>

        <CollapsibleGroup type="single" defaultValue="q1">
          <VStack gap={2}>
            {faqItems.map((item) => (
              <Card key={item.value} padding={0}>
                <Collapsible
                  value={item.value}
                  trigger={
                    <Text type="label" weight="semibold">
                      {t(item.q)}
                    </Text>
                  }
                  defaultIsOpen={item.value === 'q1'}
                >
                  <div style={{ padding: '0 1rem 1rem' }}>
                    <Text type="body" color="secondary">
                      {t(item.a)}
                    </Text>
                  </div>
                </Collapsible>
              </Card>
            ))}
          </VStack>
        </CollapsibleGroup>
      </VStack>
    </section>
  );
}
