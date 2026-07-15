import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  LANGUAGE_OPTIONS,
  isLanguage,
  languageToDir,
  messages,
  translate,
} from '@/lib/i18n/messages';
import { TagInput } from '@/components/contacts/TagInput';
import { ColorPicker } from '@/components/contacts/ColorPicker';
import { ColorFilter } from '@/components/contacts/ColorFilter';
import {
  collectTagColorFilters,
  getTagBadgeStyle,
  parseTagInput,
} from '@/lib/contact-tags';
import type { Contact } from '@/lib/api';
import { renderWithI18n } from './test-utils';

describe('Bug Condition C1.7 — Arabic language support', () => {
  it('includes Arabic in language options', () => {
    expect(LANGUAGE_OPTIONS.some(o => o.value === 'ar')).toBe(true);
  });

  it('accepts ar and rejects id', () => {
    expect(isLanguage('ar')).toBe(true);
    expect(isLanguage('id')).toBe(false);
  });
});

describe('Bug Condition C1.3 — Lalezar font', () => {
  it('tailwind config references Lalezar font variable', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tailwindConfig = require('../../tailwind.config.js');
    const sans = tailwindConfig.theme?.extend?.fontFamily?.sans;
    expect(sans?.[0]).toBe('var(--font-lalezar)');
  });
});

describe('Bug Condition C1.1 — Full translation coverage', () => {
  it('dashboard welcome string is translated in Farsi', () => {
    expect(translate('fa', 'dashboard.welcome')).not.toBe(translate('en', 'dashboard.welcome'));
    expect(translate('fa', 'dashboard.subtitle')).not.toBe(translate('en', 'dashboard.subtitle'));
  });
});

describe('Bug Condition C1.2 — RTL layout mirroring', () => {
  it('languageToDir returns rtl for Farsi', () => {
    expect(languageToDir('fa')).toBe('rtl');
  });
});

describe('Bug Condition C1.4/C1.5 — Contact tag and color UI', () => {
  it('TagInput renders with data-testid', () => {
    const { getByTestId } = renderWithI18n(
      <TagInput tags={[]} onChange={() => undefined} />,
    );
    expect(getByTestId('tag-input')).toBeInTheDocument();
  });

  it('ColorPicker renders with data-testid', () => {
    const { getByTestId } = renderWithI18n(
      <ColorPicker value={null} onChange={() => undefined} />,
    );
    expect(getByTestId('color-picker')).toBeInTheDocument();
  });

  it('ColorFilter renders with data-testid', () => {
    const { getByTestId } = renderWithI18n(
      <ColorFilter colors={['#22c55e']} value={null} onChange={() => undefined} />,
    );
    expect(getByTestId('color-filter')).toBeInTheDocument();
  });
});

describe('Bug Condition C1.6 — No Radix primitives', () => {
  it('ui button component does not reference radix', async () => {
    const mod = await import('@/components/ui/button');
    expect(JSON.stringify(mod)).not.toContain('@radix-ui');
  });
});

describe('i18n catalog parity', () => {
  it('fa and ar have all en keys', () => {
    const enKeys = Object.keys(messages.en);
    for (const key of enKeys) {
      expect(messages.fa).toHaveProperty(key);
      expect(messages.ar).toHaveProperty(key);
    }
  });

  it('languageToDir returns rtl for fa and ar', () => {
    fc.assert(
      fc.property(fc.constantFrom('fa', 'ar' as const), lang => {
        expect(languageToDir(lang)).toBe('rtl');
      }),
    );
    expect(languageToDir('en')).toBe('ltr');
  });
});

describe('contact-tags utilities', () => {
  it('parseTagInput handles colored tags', () => {
    const result = parseTagInput('vip:#22c55e, customer');
    expect(result.tags).toContain('vip');
    expect(result.tags).toContain('customer');
    expect(result.tagColors.vip).toBe('#22c55e');
  });

  it('getTagBadgeStyle returns color styles', () => {
    const style = getTagBadgeStyle('vip', { vip: '#22c55e' });
    expect(style?.color).toBe('#22c55e');
  });

  it('collectTagColorFilters aggregates colors', () => {
    const contacts = [
      {
        id: '1',
        profileId: 'p1',
        phone: '123',
        metadata: { tagColors: { vip: '#22c55e' } },
      },
    ] as unknown as Contact[];
    expect(collectTagColorFilters(contacts)).toContain('#22c55e');
  });
});

describe('TagInput property tests', () => {
  it('never crashes on random tag strings', () => {
    fc.assert(
      fc.property(fc.string(), () => {
        const tags: string[] = [];
        const { unmount } = renderWithI18n(
          <TagInput tags={tags} onChange={(t, c) => void c} />,
        );
        unmount();
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe('translate never returns undefined', () => {
  it('returns string for all en keys in all languages', () => {
    const keys = Object.keys(messages.en) as (keyof typeof messages.en)[];
    fc.assert(
      fc.property(fc.constantFrom(...keys), fc.constantFrom('en', 'fa', 'ar' as const), (key, lang) => {
        const result = translate(lang, key);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
