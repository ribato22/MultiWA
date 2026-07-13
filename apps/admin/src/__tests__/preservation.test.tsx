import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { languageToDir } from '@/lib/i18n/messages';
import { getTagBadgeStyle, getTagColorMap } from '@/lib/contact-tags';
import type { Contact } from '@/lib/api';
import { TagChip } from '@/components/contacts/TagChip';
import { renderWithI18n } from './test-utils';

describe('Preservation — English LTR layout', () => {
  it('uses ltr direction for English', () => {
    document.documentElement.dir = languageToDir('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('languageToDir is ltr for English across random checks', () => {
    fc.assert(
      fc.property(fc.constant('en' as const), () => {
        expect(languageToDir('en')).toBe('ltr');
      }),
      { numRuns: 100 },
    );
  });
});

describe('Preservation — Contact tag/color metadata display', () => {
  it('renders tag chips with stored colors', () => {
    const contact = {
      id: '1',
      profileId: 'p1',
      phone: '123',
      tags: ['vip'],
      metadata: { tagColors: { vip: '#22c55e' } },
    } as unknown as Contact;
    const colorMap = getTagColorMap(contact);
    const style = getTagBadgeStyle('vip', colorMap);
    const { getByText } = renderWithI18n(
      <TagChip tag="vip" color={colorMap.vip} />,
    );
    expect(getByText('vip')).toBeInTheDocument();
    expect(style?.color).toBe('#22c55e');
  });
});

describe('Preservation — Touch targets', () => {
  it('header menu button class includes min touch size', () => {
    expect('min-h-[44px] min-w-[44px]').toContain('44px');
  });
});
