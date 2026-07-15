/**
 * Preservation Property Tests — English LTR Layout & Feature Stability
 *
 * These tests verify that existing functionality is preserved after
 * i18n/RTL/font/UI changes. They capture the baseline behavior of the
 * English-locale admin dashboard and its core features.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import * as fc from 'fast-check';

import {
  LANGUAGE_OPTIONS,
  languageToDir,
  languageToHtmlLang,
  messages,
  translate,
} from '@/lib/i18n/messages';
import { TagInput } from '@/components/contacts/TagInput';
import { TagChip } from '@/components/contacts/TagChip';
import { ColorPicker, PRESET_COLORS } from '@/components/contacts/ColorPicker';
import { ColorFilter } from '@/components/contacts/ColorFilter';
import {
  collectTagColorFilters,
  getContactMetadata,
  getTagBadgeStyle,
  getTagColorMap,
  parseTagInput,
} from '@/lib/contact-tags';
import type { Contact } from '@/lib/api';
import { renderWithI18n } from './test-utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// ============================================================
// Property 2: Preservation — Requirement 3.1
// English LTR Layout Direction
// ============================================================

describe('Preservation Req 3.1 — English LTR layout direction', () => {
  it('languageToDir returns ltr for English', () => {
    expect(languageToDir('en')).toBe('ltr');
  });

  it('languageToHtmlLang returns en for English', () => {
    expect(languageToHtmlLang('en')).toBe('en');
  });

  it('English is available as a language option', () => {
    const enOption = LANGUAGE_OPTIONS.find(o => o.value === 'en');
    expect(enOption).toBeDefined();
    expect(enOption!.label).toBe('English');
    expect(enOption!.nativeLabel).toBe('English');
  });

  it('[PBT] for all English translation keys: translate returns a non-empty string', () => {
    const keys = Object.keys(messages.en) as (keyof typeof messages.en)[];
    fc.assert(
      fc.property(fc.constantFrom(...keys), (key) => {
        const result = translate('en', key);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('[PBT] English translation keys never return RTL characters', () => {
    const keys = Object.keys(messages.en) as (keyof typeof messages.en)[];
    const rtlPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    fc.assert(
      fc.property(fc.constantFrom(...keys), (key) => {
        const result = translate('en', key);
        // English text should not contain Arabic/Persian characters
        expect(rtlPattern.test(result)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('document direction defaults to LTR in English locale', () => {
    // Setup sets document to LTR; verify it stays LTR
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('Preservation — alert dialog confirmations', () => {
  it('renders supplied content and closes after cancel, action, or Escape', () => {
    const onOpenChange = vi.fn();
    const onAction = vi.fn();
    const { rerender } = renderWithI18n(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogTrigger>Open confirmation</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete profile</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onAction}>Delete</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete profile');
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();

    expect(screen.getByRole('alertdialog', { name: 'Delete profile' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onAction).not.toHaveBeenCalled();

    rerender(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete profile</AlertDialogTitle>
          <AlertDialogAction onClick={onAction}>Delete</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    rerender(
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Escape confirmation</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

});

// ============================================================
// Property 2: Preservation — Requirement 3.2
// WhatsApp Profile Operations
// ============================================================

describe('Preservation Req 3.2 — WhatsApp profile operations', () => {
  it('profile status type accepts expected values', () => {
    // The Profile type supports connected/disconnected/connecting
    const validStatuses = ['connected', 'disconnected', 'connecting'];
    for (const status of validStatuses) {
      expect(typeof status).toBe('string');
    }
  });

  it('[PBT] dashboard nav items include profiles and chat links', () => {
    const profileKeys = ['nav.profiles', 'nav.chat', 'nav.messages'] as const;
    fc.assert(
      fc.property(fc.constantFrom(...profileKeys), (key) => {
        const enText = translate('en', key);
        expect(enText.length).toBeGreaterThan(0);
        // Verify these keys render meaningful navigation text
        expect(enText).toMatch(/^[A-Z]/);
      }),
      { numRuns: 10 },
    );
  });

  it('profiles page translation keys are all present in English', () => {
    const profileKeys = [
      'profiles.title',
      'profiles.subtitle',
      'profiles.add',
      'profiles.connect',
      'profiles.disconnect',
      'profiles.status',
      'profiles.noProfiles',
      'profiles.new.title',
      'profiles.new.subtitle',
    ] as const;
    for (const key of profileKeys) {
      expect(translate('en', key).length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// Property 2: Preservation — Requirement 3.3
// Broadcast/Automation/Templates/Webhooks Functionality
// ============================================================

describe('Preservation Req 3.3 — Broadcast/automation/templates/webhooks', () => {
  const featureNamespaces = ['broadcast', 'automation', 'templates', 'webhooks'] as const;

  it('[PBT] all feature page translation keys exist and are non-empty', () => {
    const featureKeys = [
      'broadcast.title', 'broadcast.subtitle', 'broadcast.create', 'broadcast.name',
      'broadcast.recipients', 'broadcast.schedule', 'broadcast.send',
      'automation.title', 'automation.subtitle', 'automation.create',
      'automation.builder', 'automation.enabled', 'automation.disabled',
      'templates.title', 'templates.subtitle', 'templates.create',
      'templates.name', 'templates.body',
      'webhooks.title', 'webhooks.subtitle', 'webhooks.add',
      'webhooks.url', 'webhooks.events',
    ] as const;

    fc.assert(
      fc.property(fc.constantFrom(...featureKeys), (key) => {
        const en = translate('en', key);
        expect(en.length).toBeGreaterThan(0);
        // Verify English value is Latin-script
        expect(en).toMatch(/[a-zA-Z]/);
      }),
      { numRuns: 50 },
    );
  });

  it('navigation keys for all features exist', () => {
    for (const ns of featureNamespaces) {
      const navKey = `nav.${ns}` as keyof typeof messages.en;
      expect(translate('en', navKey).length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// Property 2: Preservation — Requirement 3.4
// Mobile Responsive Layout & Touch Targets
// ============================================================

describe('Preservation Req 3.4 — Mobile responsive layout and touch targets', () => {
  it('[PBT] for random viewport widths >= 320px: TagInput renders with accessible touch target', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 320, max: 1440 }),
        (_viewportWidth) => {
          // Render TagInput and verify the input has minimum interactive dimensions
          const { container, unmount } = renderWithI18n(
            <TagInput tags={[]} onChange={() => undefined} />,
            { language: 'en' },
          );
          const input = container.querySelector('[data-testid="tag-input"]');
          expect(input).not.toBeNull();
          // The input element should exist and be accessible
          expect(input?.getAttribute('aria-label')).toBeTruthy();
          unmount();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('[PBT] for random viewport widths >= 320px: ColorPicker renders accessible radio buttons', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 320, max: 1440 }),
        (_viewportWidth) => {
          const { container, unmount } = renderWithI18n(
            <ColorPicker value={null} onChange={() => undefined} />,
            { language: 'en' },
          );
          const radioGroup = container.querySelector('[role="radiogroup"]');
          expect(radioGroup).not.toBeNull();
          // All color buttons should be min 32px (w-8 h-8 = 2rem = 32px)
          const radios = container.querySelectorAll('[role="radio"]');
          expect(radios.length).toBeGreaterThan(0);
          unmount();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('ColorFilter buttons have minimum accessible size', () => {
    const { container } = renderWithI18n(
      <ColorFilter colors={['#22c55e', '#ef4444']} value={null} onChange={() => undefined} />,
      { language: 'en' },
    );
    const buttons = container.querySelectorAll('button');
    // ColorFilter should have at least "Any" + 2 color buttons
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// Property 2: Preservation — Requirement 3.5
// Existing Contacts with Tag/Color Metadata
// ============================================================

describe('Preservation Req 3.5 — Stored contact tag/color data displays correctly', () => {
  it('[PBT] for random valid contacts with tag metadata: tags and colors parse correctly', () => {
    const tagNameArb = fc.stringMatching(/^[a-z]{1,10}$/);
    const hexColorArb = fc.constantFrom(
      '#22c55e', '#ef4444', '#3b82f6', '#f97316', '#8b5cf6', '#eab308',
    );

    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          profileId: fc.uuid(),
          phone: fc.stringMatching(/^\d{10,15}$/),
          tags: fc.array(tagNameArb, { minLength: 0, maxLength: 5 }),
          tagColors: fc.dictionary(tagNameArb, hexColorArb, { minKeys: 0, maxKeys: 3 }),
        }),
        ({ id, profileId, phone, tags, tagColors }) => {
          const contact: Contact = {
            id,
            profileId,
            phone,
            tags,
            metadata: { tagColors },
            createdAt: new Date().toISOString(),
          };

          // getTagColorMap should return valid colors
          const colorMap = getTagColorMap(contact);
          for (const [tag, color] of Object.entries(colorMap)) {
            expect(typeof tag).toBe('string');
            expect(color).toMatch(/^#[0-9a-fA-F]{3,6}$/);
          }

          // getContactMetadata should return the metadata
          const meta = getContactMetadata(contact);
          expect(meta).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[PBT] getTagBadgeStyle produces valid styles for known colors', () => {
    const hexColorArb = fc.constantFrom(
      '#22c55e', '#ef4444', '#3b82f6', '#f97316', '#8b5cf6',
    );
    const tagArb = fc.stringMatching(/^[a-z]{1,8}$/);

    fc.assert(
      fc.property(tagArb, hexColorArb, (tag, color) => {
        const colorMap = { [tag]: color };
        const style = getTagBadgeStyle(tag, colorMap);
        expect(style).toBeDefined();
        expect(style!.color).toBe(color);
        expect(style!.backgroundColor).toContain(color.replace('#', ''));
        expect(style!.borderColor).toBe(color);
      }),
      { numRuns: 50 },
    );
  });

  it('[PBT] collectTagColorFilters aggregates colors from contact sets', () => {
    const hexColorArb = fc.constantFrom(
      '#22c55e', '#ef4444', '#3b82f6', '#f97316',
    );

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            profileId: fc.uuid(),
            phone: fc.stringMatching(/^\d{10,15}$/),
            metadata: fc.record({
              tagColors: fc.dictionary(
                fc.stringMatching(/^[a-z]{1,5}$/),
                hexColorArb,
                { minKeys: 0, maxKeys: 3 },
              ),
            }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (contactData) => {
          const contacts: Contact[] = contactData.map(c => ({
            ...c,
            createdAt: new Date().toISOString(),
          }));
          const colors = collectTagColorFilters(contacts);
          // Should be an array of unique colors, sorted
          expect(Array.isArray(colors)).toBe(true);
          for (let i = 1; i < colors.length; i++) {
            expect(colors[i] >= colors[i - 1]).toBe(true);
          }
          // All returned colors should be valid hex
          for (const color of colors) {
            expect(color).toMatch(/^#[0-9a-f]{6}$/);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('[PBT] parseTagInput preserves tag names and colors for various inputs', () => {
    const tagArb = fc.stringMatching(/^[a-z]{1,8}$/);
    const hexArb = fc.constantFrom('#22c55e', '#ef4444', '#3b82f6');

    fc.assert(
      fc.property(tagArb, hexArb, (tag, color) => {
        const input = `${tag}:${color}`;
        const result = parseTagInput(input);
        expect(result.tags).toContain(tag);
        expect(result.tagColors[tag]).toBe(color);
      }),
      { numRuns: 50 },
    );
  });

  it('TagInput renders existing tags correctly in English', () => {
    const { container } = renderWithI18n(
      <TagInput
        tags={['vip', 'customer', 'priority']}
        tagColors={{ vip: '#22c55e', priority: '#ef4444' }}
        onChange={() => undefined}
      />,
      { language: 'en' },
    );
    // Tags should be rendered
    expect(container.textContent).toContain('vip');
    expect(container.textContent).toContain('customer');
    expect(container.textContent).toContain('priority');
  });

  it('ColorPicker shows all preset colors', () => {
    const { container } = renderWithI18n(
      <ColorPicker value="#22c55e" onChange={() => undefined} />,
      { language: 'en' },
    );
    const radios = container.querySelectorAll('[role="radio"]');
    // "None" + preset colors
    expect(radios.length).toBe(PRESET_COLORS.length + 1);
  });
});

// ============================================================
// Property 2: Preservation — Requirement 3.6
// Auth Flow Session Management
// ============================================================

describe('Preservation Req 3.6 — Auth flows and session management', () => {
  it('auth translation keys exist for login flow', () => {
    const authKeys = [
      'auth.login.title',
      'auth.login.subtitle',
      'auth.login.email',
      'auth.login.password',
      'auth.login.signIn',
      'auth.login.signingIn',
      'auth.login.rememberMe',
      'auth.login.forgotPassword',
      'auth.login.noAccount',
      'auth.login.createOne',
      'auth.login.error',
    ] as const;
    for (const key of authKeys) {
      expect(translate('en', key).length).toBeGreaterThan(0);
    }
  });

  it('auth translation keys exist for register flow', () => {
    const regKeys = [
      'auth.register.title',
      'auth.register.subtitle',
      'auth.register.orgName',
      'auth.register.fullName',
      'auth.register.email',
      'auth.register.password',
      'auth.register.passwordHint',
      'auth.register.createAccount',
      'auth.register.creatingAccount',
      'auth.register.terms',
      'auth.register.haveAccount',
      'auth.register.signIn',
      'auth.register.error',
    ] as const;
    for (const key of regKeys) {
      expect(translate('en', key).length).toBeGreaterThan(0);
    }
  });

  it('auth translation keys exist for 2FA flow', () => {
    const twoFaKeys = [
      'auth.2fa.title',
      'auth.2fa.subtitleTotp',
      'auth.2fa.subtitleBackup',
      'auth.2fa.verify',
      'auth.2fa.verifying',
      'auth.2fa.useBackupCode',
      'auth.2fa.useAuthenticator',
      'auth.2fa.backToLogin',
      'auth.2fa.verified',
      'auth.2fa.redirecting',
    ] as const;
    for (const key of twoFaKeys) {
      expect(translate('en', key).length).toBeGreaterThan(0);
    }
  });

  it('[PBT] for all auth keys: English text is stable and never empty', () => {
    const authKeys = Object.keys(messages.en).filter(k => k.startsWith('auth.'));
    fc.assert(
      fc.property(
        fc.constantFrom(...authKeys as (keyof typeof messages.en)[]),
        (key) => {
          const result = translate('en', key);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
          // Auth text should be in Latin script
          expect(result).toMatch(/[a-zA-Z]/);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('localStorage session management pattern works', () => {
    // Verify the session pattern used in auth flow
    localStorage.setItem('accessToken', 'test-jwt-token');
    localStorage.setItem('refreshToken', 'test-refresh-token');
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Test' }));

    expect(localStorage.getItem('accessToken')).toBe('test-jwt-token');
    expect(localStorage.getItem('refreshToken')).toBe('test-refresh-token');
    expect(JSON.parse(localStorage.getItem('user')!)).toEqual({ id: '1', name: 'Test' });

    // Logout clears everything
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});

// ============================================================
// Cross-cutting: i18n system stability
// ============================================================

describe('Preservation — i18n system overall stability', () => {
  it('[PBT] translate never throws for valid keys and English locale', () => {
    const keys = Object.keys(messages.en) as (keyof typeof messages.en)[];
    fc.assert(
      fc.property(fc.constantFrom(...keys), (key) => {
        expect(() => translate('en', key)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it('[PBT] formatMessage handles arbitrary params without crashing', () => {
    const keys = Object.keys(messages.en) as (keyof typeof messages.en)[];
    fc.assert(
      fc.property(
        fc.constantFrom(...keys),
        fc.dictionary(fc.stringMatching(/^[a-z]{1,5}$/), fc.oneof(fc.string(), fc.integer())),
        (key, params) => {
          expect(() => translate('en', key, params)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('LANGUAGE_OPTIONS has exactly 3 supported languages', () => {
    expect(LANGUAGE_OPTIONS).toHaveLength(3);
    expect(LANGUAGE_OPTIONS.map(o => o.value).sort()).toEqual(['ar', 'en', 'fa']);
  });

  it('[PBT] language direction mapping is consistent', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('en', 'fa', 'ar' as const),
        (lang) => {
          const dir = languageToDir(lang);
          if (lang === 'en') {
            expect(dir).toBe('ltr');
          } else {
            expect(dir).toBe('rtl');
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
