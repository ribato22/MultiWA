'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Grid } from '@astryxdesign/core/Grid';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Field } from '@astryxdesign/core/Field';
import { Switch } from '@astryxdesign/core/Switch';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { useLandingTheme } from '@/hooks/use-landing-theme';
import { THEME_IDS, getThemeEntry, type ThemeId } from '@/themes';
import { useI18n } from '@/lib/i18n/provider';

function ThemeSwatch({
  id,
  isActive,
  onSelect,
}: {
  id: ThemeId;
  isActive: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  const entry = getThemeEntry(id);

  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={isActive}
      aria-label={`${entry.label} theme`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 8,
        minHeight: 44,
        minWidth: 44,
        padding: 12,
        borderRadius: 12,
        border: isActive
          ? '2px solid var(--color-border-emphasized)'
          : '1px solid var(--color-border)',
        background: 'var(--color-background-surface)',
        cursor: 'pointer',
        textAlign: 'start',
        transition: 'border-color 200ms ease, box-shadow 200ms ease',
        boxShadow: isActive ? 'var(--shadow-med)' : 'var(--shadow-low)',
      }}
    >
      <HStack gap={1} vAlign="center">
        {entry.previewColors.map((color) => (
          <span
            key={color}
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: color,
              border: '1px solid var(--color-border)',
            }}
          />
        ))}
      </HStack>
      <Text type="label" weight="semibold">
        {entry.label}
      </Text>
      <Text type="supporting" color="secondary">
        {entry.description}
      </Text>
    </button>
  );
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { themeId, setThemeId } = useLandingTheme();

  if (compact) {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Text type="label" color="secondary">
          {t('landing.themePicker.label')}
        </Text>
        <select
          value={themeId}
          onChange={(e) => setThemeId(e.target.value as ThemeId)}
          aria-label={t('landing.themePicker.label')}
          style={{
            minHeight: 44,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'var(--color-background-surface)',
            color: 'var(--color-text-primary)',
            font: 'inherit',
          }}
        >
          {THEME_IDS.map((id) => (
            <option key={id} value={id}>
              {getThemeEntry(id).label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <VStack gap={4} width="100%">
      <VStack gap={1}>
        <Text type="label" weight="semibold">
          {t('landing.themePicker.label')}
        </Text>
        <Text type="supporting" color="secondary">
          {t('landing.themePicker.description')}
        </Text>
      </VStack>
      <Grid columns={{ minWidth: 220, max: 3 }} gap={3}>
        {THEME_IDS.map((id) => (
          <ThemeSwatch
            key={id}
            id={id}
            isActive={themeId === id}
            onSelect={setThemeId}
          />
        ))}
      </Grid>
    </VStack>
  );
}

export function ThemeSwitcherBar() {
  const { themeId, setThemeId } = useLandingTheme();

  return (
    <HStack gap={1} vAlign="center" style={{ flexWrap: 'wrap' }}>
      {THEME_IDS.map((id) => {
        const entry = getThemeEntry(id);
        const isActive = themeId === id;
        return (
          <Button
            key={id}
            label={entry.label}
            variant={isActive ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setThemeId(id)}
          />
        );
      })}
    </HStack>
  );
}

export function ThemeGallerySection() {
  const { t } = useI18n();

  return (
    <section id="themes" className="landing-section" style={{ paddingBlock: '4rem' }}>
      <VStack gap={6}>
        <VStack gap={2} hAlign="center" style={{ textAlign: 'center' }}>
          <Text type="label" color="accent" weight="semibold">
            {t('landing.themeGallery.eyebrow')}
          </Text>
          <Heading level={2} justify="center">
            {t('landing.themeGallery.title')}
          </Heading>
          <Text type="large" color="secondary" display="block">
            {t('landing.themeGallery.subtitle')}
          </Text>
        </VStack>
        <Card padding={6}>
          <ThemeSwitcher />
        </Card>
      </VStack>
    </section>
  );
}

export function ComponentPlaygroundSection() {
  const { t } = useI18n();
  const { activeTheme } = useLandingTheme();
  const [switchOn, setSwitchOn] = useState(true);
  const [checked, setChecked] = useState(false);

  return (
    <section id="playground" className="landing-section" style={{ paddingBlock: '4rem' }}>
      <VStack gap={6}>
        <VStack gap={2} hAlign="center" style={{ textAlign: 'center' }}>
          <Text type="label" color="accent" weight="semibold">
            {t('landing.playground.eyebrow')}
          </Text>
          <Heading level={2} justify="center">
            {t('landing.playground.title')}
          </Heading>
          <Text type="body" color="secondary" display="block" style={{ maxWidth: 560 }}>
            {t('landing.playground.subtitle', { theme: activeTheme.label })}
          </Text>
        </VStack>

        <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
          <Card padding={5}>
            <VStack gap={4}>
              <Heading level={3}>{t('landing.playground.buttons')}</Heading>
              <HStack gap={2} style={{ flexWrap: 'wrap' }}>
                <Button label="Primary" variant="primary" />
                <Button label="Secondary" variant="secondary" />
                <Button label="Ghost" variant="ghost" />
                <Button label="Destructive" variant="destructive" />
              </HStack>
            </VStack>
          </Card>

          <Card padding={5}>
            <VStack gap={4}>
              <Heading level={3}>{t('landing.playground.badges')}</Heading>
              <HStack gap={2} style={{ flexWrap: 'wrap' }}>
                <Badge label="Info" variant="info" />
                <Badge label="Success" variant="success" />
                <Badge label="Warning" variant="warning" />
                <Badge label="Error" variant="error" />
                <Badge label="Purple" variant="purple" />
              </HStack>
            </VStack>
          </Card>

          <Card padding={5}>
            <VStack gap={4}>
              <Heading level={3}>{t('landing.playground.forms')}</Heading>
              <Field label="Email address" inputID="playground-email">
                <input
                  id="playground-email"
                  type="email"
                  placeholder="you@company.com"
                  style={{
                    width: '100%',
                    minHeight: 44,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-background-surface)',
                    color: 'var(--color-text-primary)',
                    font: 'inherit',
                  }}
                />
              </Field>
              <Switch
                label="Enable notifications"
                value={switchOn}
                onChange={(value) => setSwitchOn(value)}
              />
              <CheckboxInput
                label="I agree to the terms"
                value={checked}
                onChange={(value) => setChecked(value)}
              />
            </VStack>
          </Card>

          <Card padding={5}>
            <VStack gap={4}>
              <Heading level={3}>{t('landing.playground.feedback')}</Heading>
              <Banner
                status="info"
                title={t('landing.playground.bannerTitle')}
                description={t('landing.playground.bannerDescription')}
                isDismissable
              />
            </VStack>
          </Card>
        </Grid>
      </VStack>
    </section>
  );
}
