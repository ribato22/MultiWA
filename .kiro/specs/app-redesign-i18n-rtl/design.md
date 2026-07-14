# App Redesign i18n RTL Bugfix Design

## Overview

The MultiWA admin dashboard suffers from multiple compounding deficiencies that collectively render it unusable for RTL-language users and fail to meet the target visual quality. The i18n system only covers ~35 navigation/header keys while the app has hundreds of UI strings across 15+ pages. RTL layout is declared but never enforced at the component level. The font is wrong (Inter instead of Lalezar). Contact tagging UI is missing despite having backend utilities. Indonesian must be replaced with Arabic. Interactive controls need a consistent, observable accessibility, keyboard, focus, feedback, and RTL contract while retaining the current Tailwind token stack where it already describes layout and theming.

This design formalizes each deficiency as a bug condition, defines preservation boundaries, hypothesizes root causes, and outlines implementation changes with a property-based testing strategy.

## Glossary

- **Bug_Condition (C)**: Any of the seven deficiency conditions described in bugfix.md (1.1–1.7) that produce incorrect behavior
- **Property (P)**: The correct behavior specified in expected behavior clauses 2.1–2.7
- **Preservation**: Existing functionality (English LTR layout, WhatsApp profile management, broadcast/automation/templates/webhooks, mobile responsiveness, stored tag data, auth flow) that must remain unchanged
- **i18n catalog**: The `messages.ts` file at `apps/admin/src/lib/i18n/messages.ts` containing translation keys and catalogs for each language
- **I18nProvider**: The React context at `apps/admin/src/lib/i18n/provider.tsx` that provides `t()`, `language`, `dir`, and `setLanguage` to the component tree
- **Logical CSS properties**: CSS properties using `inline-start`/`inline-end`/`block-start`/`block-end` instead of physical `left`/`right`/`top`/`bottom`, enabling automatic RTL mirroring
- **Interactive UI contract**: Observable behavior shared by controls across pages: enabled Button activates once, disabled Button does not activate, and focus is visible; Select and Menu expose open/selected state and support Arrow, Enter, Space, and Escape; Tabs expose selected tab/active panel state and support Arrow, Home, End, Enter, and Space; Dialog and AlertDialog expose accessible name/description, contain and restore focus, and support Escape dismissal when allowed; Toast announces/dismisses; popups use logical RTL alignment.
- **Contact metadata**: The `metadata` JSON field on Contact records that stores `primaryTag`, `tagColors`, and other extensible properties
- **Lalezar**: A Persian display font from Google Fonts that supports Latin, Arabic, and Persian scripts

## Bug Details

### Bug Condition

The bug manifests as seven interrelated failures whenever a user interacts with the admin dashboard in a non-English context or expects modern UX patterns. The conditions overlap — an RTL user simultaneously hits C1.1 (untranslated content), C1.2 (broken mirroring), C1.3 (wrong font), and C1.6 (inconsistent interactive behavior).

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { language: Language, page: Page, interaction: Interaction }
  OUTPUT: boolean
  
  // C1: Untranslated content
  LET untranslated = input.language IN ['fa', 'ar']
    AND pageHasUntranslatedStrings(input.page)
  
  // C2: Broken RTL mirroring
  LET brokenRTL = input.language IN ['fa', 'ar']
    AND componentUsesPhysicalCSS(input.page)
  
  // C3: Wrong font
  LET wrongFont = fontFamily(input.page) != 'Lalezar'
  
  // C4: Missing tag UI
  LET missingTagUI = input.page == 'contacts'
    AND input.interaction == 'manage_tags'
  
  // C5: Missing color UI
  LET missingColorUI = input.page == 'contacts'
    AND input.interaction IN ['assign_color', 'filter_by_color']
  
  // C6: Inconsistent interactive UI behavior
  LET inconsistentInteractiveUI = interactiveControlsFailContract(input.page)
  
  // C7: Missing Arabic
  LET missingArabic = input.language == 'ar'
    AND NOT languageAvailable('ar')
  
  RETURN untranslated OR brokenRTL OR wrongFont OR missingTagUI
         OR missingColorUI OR inconsistentInteractiveUI OR missingArabic
END FUNCTION
```

### Examples

- **C1.1**: User selects Farsi → navigates to Dashboard → stat card titles ("Total Messages", "Active Profiles") remain in English
- **C1.2**: User selects Farsi → sidebar renders on the left with left-aligned text, icons on the left of labels; chat bubbles sent by user appear on the left instead of right
- **C1.3**: Any page load → body renders in Inter font (400/500/600/700) instead of Lalezar
- **C1.4**: User opens Contacts → sees contact list but no tag input, no tag chips, no way to add "#VIP" to a contact
- **C1.5**: User opens Contacts → no color picker, no colored dots, no filter-by-color dropdown
- **C1.6**: A Button, Select, Menu, Tabs, Dialog, AlertDialog, or Toast lacks its observable disabled/activation/focus, keyboard/state, accessible modal, announcement/dismissal, or logical RTL-alignment behavior
- **C1.7**: User opens language dropdown → sees only English, فارسی, Bahasa Indonesia — no العربية option

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- English LTR layout must continue to display all content correctly with left-to-right reading order
- WhatsApp profile management (connect, disconnect, send messages, view QR) must function identically regardless of language or UI redesign
- Broadcast, automation, templates, and webhook features must maintain the same functionality and API contracts
- Mobile responsive layouts must retain proper touch targets (min 44px) and safe-area handling
- Existing contacts with stored tags and color metadata must display that data correctly after the update
- Authentication flow (login/register) must use the same session management and API endpoints

**Scope:**
All inputs that do NOT involve the seven bug conditions should be completely unaffected. This includes:
- API request/response formats and payload structures
- WebSocket connections for real-time updates
- Server-side data models and database schema
- Existing English translations that are already correct
- Browser storage keys and formats (localStorage for language preference)

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Incomplete i18n catalog (C1.1, C1.7)**: The `messages.ts` file only defines ~35 keys covering `nav.*`, `header.*`, and `chat.unread`. The remaining 200+ UI strings across all pages are hardcoded in English within component JSX. Indonesian (`id`) locale exists instead of Arabic (`ar`).

2. **Physical CSS properties (C1.2)**: Components use `left`, `right`, `margin-left`, `padding-right`, `text-align: left`, `rounded-bl-sm`, etc. The `dir="rtl"` attribute on `<html>` has no effect when components use physical rather than logical properties. The sidebar uses `translateX(-100%)` for mobile hide which doesn't flip. Chat bubbles use `rounded-br-sm` / `rounded-bl-sm` hardcoded.

3. **Font configuration (C1.3)**: `layout.tsx` imports `Inter` from `next/font/google` and applies it via `--font-inter` CSS variable. Lalezar is never imported or referenced anywhere. The user's requirement is Lalezar for all content (which differs from the MASTER.md design system suggesting Fira Code/Fira Sans — the user's requirement takes precedence).

4. **Missing UI components (C1.4, C1.5)**: The `contact-tags.ts` utility has full data-layer support (parse tags, color maps, badge styles) but no React components consume it. No `<TagInput>`, `<ColorPicker>`, or `<ColorFilter>` components exist. The contacts page renders a basic list without tag management or color assignment.

5. **Inconsistent interactive UI behavior (C1.6)**: Existing UI controls do not uniformly demonstrate the required disabled/activation/focus, keyboard/state, accessible modal, toast, and logical RTL popup behaviors. The current Tailwind token and utility stack remains the styling foundation where it already covers tokens and RTL layout.

## Correctness Properties

Property 1: Bug Condition - Full Translation Coverage

_For any_ page render where language is set to Farsi or Arabic (isBugCondition C1.1/C1.7 holds), the system SHALL display all visible UI text — page titles, form labels, buttons, placeholders, error messages, table headers, tooltips, empty states, stat cards, and dashboard widgets — in the selected language with zero English fallback strings visible.

**Validates: Requirements 2.1, 2.7**

Property 2: Bug Condition - RTL Layout Mirroring

_For any_ page render where language is Farsi or Arabic (isBugCondition C1.2 holds), the system SHALL mirror the layout correctly — sidebar on the right, text right-aligned, margins/paddings flipped via logical properties, directional icons reversed, chat bubbles positioned with sent-by-user on the inline-end side.

**Validates: Requirements 2.2**

Property 3: Bug Condition - Lalezar Font Rendering

_For any_ page load (isBugCondition C1.3 holds), the system SHALL render all text using the Lalezar font family as the primary font for headings and body text across all languages.

**Validates: Requirements 2.3**

Property 4: Bug Condition - Contact Tag Management UI

_For any_ user interaction on the Contacts page where the intent is to manage tags (isBugCondition C1.4 holds), the system SHALL provide inline tag input with autocomplete, tag chips with edit/remove capability, and the ability to add new tags.

**Validates: Requirements 2.4**

Property 5: Bug Condition - Contact Color Assignment UI

_For any_ user interaction on the Contacts page where the intent is to assign or filter by color (isBugCondition C1.5 holds), the system SHALL provide a color picker for assignment and a filter/group control for the contact list.

**Validates: Requirements 2.5**

Property 6: Bug Condition - Interactive UI Contract

_For any_ page render or supported control interaction (isBugCondition C1.6 holds), the system SHALL provide a consistent modern interface with observable behavior: enabled Button activation exactly once, disabled Button no activation, and visible focus; Select and Menu open/selected state plus Arrow, Enter, Space, and Escape handling; Tabs selected tab/active panel state plus Arrow, Home, End, Enter, and Space handling; Dialog and AlertDialog accessible name/description, focus containment/restoration, and Escape dismissal when allowed; Toast announcement/dismissal; and logical RTL popup alignment.

**Validates: Requirements 2.6**

Property 7: Preservation - Existing Functionality

_For any_ input where none of the seven bug conditions hold (language is English with no tag/color/component interactions), the fixed system SHALL produce the same behavior as the original system, preserving English LTR layout, WhatsApp profile management, broadcast/automation/templates/webhooks functionality, mobile responsiveness, stored contact data integrity, and authentication flows.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**1. i18n Catalog Expansion & Arabic Addition**

**Files**: `apps/admin/src/lib/i18n/messages.ts`, `apps/admin/src/lib/i18n/provider.tsx`

**Specific Changes**:
- Replace `Language = 'en' | 'fa' | 'id'` with `Language = 'en' | 'fa' | 'ar'`
- Remove Indonesian (`id`) catalog entirely
- Add Arabic (`ar`) catalog with full translations
- Expand all catalogs from ~35 keys to ~300+ keys covering every page (dashboard stats, form labels, buttons, placeholders, error messages, table headers, tooltips, empty states)
- Update `LANGUAGE_OPTIONS` to include `{ value: 'ar', label: 'Arabic', nativeLabel: 'العربية' }`
- Update `languageToDir()` to return `'rtl'` for both `'fa'` and `'ar'`
- Update `languageToHtmlLang()` to return `'ar'` for Arabic

**2. RTL Layout with Logical CSS Properties**

**Files**: `apps/admin/src/app/globals.css`, all component files using physical properties

**Specific Changes**:
- Replace all `left`/`right` with `inset-inline-start`/`inset-inline-end`
- Replace `margin-left`/`margin-right` with `margin-inline-start`/`margin-inline-end`
- Replace `padding-left`/`padding-right` with `padding-inline-start`/`padding-inline-end`
- Replace `text-align: left`/`right` with `text-align: start`/`end`
- Replace `rounded-bl-*`/`rounded-br-*` with logical equivalents using `[dir=rtl]` variants or Tailwind RTL plugin
- Update `translateX(-100%)` for sidebar mobile to use `inset-inline-start` positioning
- Add Tailwind `rtl:` variant utilities for directional icons (chevrons, arrows)
- Update chat bubble tails to flip based on `dir` attribute

**3. Font Migration to Lalezar**

**Files**: `apps/admin/src/app/layout.tsx`, `apps/admin/src/app/globals.css`, `tailwind.config.js`

**Specific Changes**:
- Replace `Inter` import with `Lalezar` from `next/font/google` with `subsets: ['latin', 'arabic']`
- Update CSS variable from `--font-inter` to `--font-lalezar`
- Update body className to use new font variable
- Update Tailwind config `fontFamily` to use Lalezar as primary
- Lalezar is a display font — for body text readability, consider a secondary font (Vazirmatn for Farsi/Arabic body text, system sans-serif for English) or accept user's choice of Lalezar-only

**4. Contact Tag Management UI**

**Files**: New components + contacts page update

**New Components**:
- `src/components/contacts/TagInput.tsx` — Inline tag input with autocomplete, consuming existing `parseTagInput()` utility
- `src/components/contacts/TagChip.tsx` — Colored tag badge with remove button, using `getTagBadgeStyle()`
- `src/components/contacts/ColorPicker.tsx` — Preset color palette picker for assigning colors to contacts
- `src/components/contacts/ColorFilter.tsx` — Filter dropdown using `collectTagColorFilters()` utility

**Integration**:
- Update contacts list/detail page to render TagInput and ColorPicker
- Wire mutations to API (PATCH contact metadata with tags/colors)
- Add autocomplete source from existing tags across all contacts

**5. Interactive UI Contract Completion**

**Files**: Existing files in `apps/admin/src/components/ui/` as required by behavior

**Specific Changes**:
- Preserve the current Tailwind token and utility infrastructure for theming, spacing, and logical RTL layout.
- Ensure an enabled Button activates exactly once, a disabled Button does not activate, and keyboard focus is visibly indicated.
- Ensure Select and Menu expose open and selected state and support Arrow, Enter, Space, and Escape keys; ensure Tabs expose selected tab and active panel state and support Arrow, Home, End, Enter, and Space keys.
- Ensure Dialog and AlertDialog have accessible names and descriptions, contain focus while open, restore focus to the trigger on close, and close on Escape when dismissal is allowed.
- Ensure Toasts announce meaningful status and can be dismissed through user action.
- Ensure popup positioning uses logical inline alignment so the same control aligns correctly in LTR and RTL.
- Verify visual consistency on desktop and mobile browser viewports without implementation or package identity as a pass/fail criterion.

**6. Design Token Overhaul**

**Files**: `apps/admin/src/app/globals.css`, `tailwind.config.js`

**Specific Changes**:
- Align CSS variables with MASTER.md dark-mode OLED palette (background #0F172A, card #1E293B, border #334155, text #F8FAFC, CTA #22C55E)
- Add spacing tokens as CSS variables (`--space-xs` through `--space-3xl`)
- Add shadow depth tokens (`--shadow-sm` through `--shadow-xl`)
- Maintain the existing WhatsApp green accent as CTA color
- Add RTL-aware animation keyframes (slide directions flip with `dir`)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug condition on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Render each page in Farsi/Arabic locale and assert that:
1. No English text leaks through (scan rendered DOM for Latin-only text nodes)
2. Layout direction properties are correct (computed styles use logical values)
3. Font-family resolves to Lalezar
4. Tag/color UI exists on contacts page
5. C1.6 controls expose observable contracts: enabled Button activates once, disabled Button activates zero times, focus is visible; Select/Menu support Arrow, Enter, Space, Escape with open/selected state; Tabs support Arrow, Home, End, Enter, Space with selected tab/active panel state; Dialog/AlertDialog expose name/description, contain and restore focus, and dismiss on allowed Escape; Toast announces through a live region and dismisses; RTL/LTR popup edges align logically
Run on UNFIXED code to observe failures and validate root causes.

**Test Cases**:
1. **Translation Coverage Test**: Render Dashboard in Farsi → scan all visible text nodes → assert none match English-only pattern (will fail on unfixed code — most content is English)
2. **RTL Mirroring Test**: Render sidebar in Farsi → assert computed `inset-inline-start` or that sidebar appears on right side of viewport (will fail — sidebar uses physical `left: 0`)
3. **Font Test**: Render any page → assert `font-family` computed on body includes "Lalezar" (will fail — Inter is the only loaded font)
4. **Tag UI Test**: Render contacts detail → query for tag input element (will fail — component doesn't exist)
5. **Arabic Language Test**: Attempt to set language to 'ar' → assert it's accepted as valid (will fail — `isLanguage()` only accepts 'en'|'fa'|'id')
6. **Interactive UI Contract Test**: Exercise Button, Select, Menu, Tabs, Dialog, AlertDialog, and Toast through accessible roles and keyboard input; assert the C1.6 states, focus lifecycle, live announcement/dismissal, and logical RTL/LTR popup alignment described above

**Expected Counterexamples**:
- Dashboard stat cards, form labels, button text render in English when Farsi is selected
- Sidebar has `left: 0` in computed styles regardless of `dir="rtl"`
- `getComputedStyle(body).fontFamily` returns "Inter" variants
- `document.querySelector('[data-testid="tag-input"]')` returns null on contacts page

### Fix Checking

**Goal**: Verify that for all inputs where any bug condition holds, the fixed system produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := renderPage_fixed(input.language, input.page, input.interaction)
  ASSERT expectedBehavior(result):
    IF input involves C1.1/C1.7:
      ASSERT allVisibleText(result).every(t => isInLanguage(t, input.language))
    IF input involves C1.2:
      ASSERT layoutDirection(result) == 'rtl'
      AND sidebarPosition(result) == 'inline-end'
    IF input involves C1.3:
      ASSERT fontFamily(result).includes('Lalezar')
    IF input involves C1.4:
      ASSERT tagInputExists(result) AND tagChipsRendered(result)
    IF input involves C1.5:
      ASSERT colorPickerExists(result) AND colorFilterExists(result)
    IF input involves C1.6:
      ASSERT enabledButtonActivatesOnce(result) AND disabledButtonDoesNotActivate(result)
      AND visibleFocus(result) AND selectMenuKeyboardAndState(result)
      AND tabsKeyboardAndState(result) AND accessibleModalFocusLifecycle(result)
      AND toastAnnouncementAndDismissal(result) AND logicalPopupAlignment(result)
    IF input involves C1.7:
      ASSERT languageOptions(result).includes('ar')
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where no bug condition holds (English LTR, no tag/color interactions, existing features), the fixed system produces the same behavior as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT renderPage_original(input) == renderPage_fixed(input)
  // Specifically:
  ASSERT englishLTRLayout_fixed() == englishLTRLayout_original()
  ASSERT whatsappProfileOps_fixed() == whatsappProfileOps_original()
  ASSERT broadcastAutomation_fixed() == broadcastAutomation_original()
  ASSERT mobileResponsive_fixed() == mobileResponsive_original()
  ASSERT storedContactData_fixed() == storedContactData_original()
  ASSERT authFlow_fixed() == authFlow_original()
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many permutations of English-locale page renders to catch visual regressions
- It tests random contact data to ensure existing tags/colors display correctly
- It exercises API contracts with varied payloads to confirm no breaking changes

**Test Plan**: Observe behavior on UNFIXED code first for all English-locale interactions, then write property-based tests capturing that baseline.

**Test Cases**:
1. **English Layout Preservation**: Verify all pages render identically in English after redesign (same content, same positions, same spacing patterns)
2. **WhatsApp Profile Preservation**: Verify connect/disconnect/QR/send-message flows work correctly
3. **Feature Preservation**: Verify broadcast, automation, templates, webhooks continue working
4. **Mobile Preservation**: Verify responsive breakpoints and touch targets are maintained
5. **Contact Data Preservation**: Verify existing contacts with tags and colors display correctly
6. **Auth Preservation**: Verify login/register flows are unaffected

### Unit Tests

- Test `languageToDir()` returns 'rtl' for both 'fa' and 'ar', 'ltr' for 'en'
- Test `isLanguage()` accepts 'en', 'fa', 'ar' and rejects 'id', null, undefined
- Test expanded translation catalog has all required keys for each language (no missing keys)
- Test `parseTagInput()` handles edge cases (empty string, duplicate tags, invalid colors)
- Test `getTagBadgeStyle()` returns correct styles for each color
- Test `collectTagColorFilters()` aggregates colors from contact set
- Test enabled Button activation once, disabled Button zero activation, and visible focus
- Test Select and Menu open/selected state plus Arrow, Enter, Space, and Escape; test Tabs selected tab/active panel plus Arrow, Home, End, Enter, and Space

### Property-Based Tests

- Generate random language + page combinations → verify no English leak in RTL languages
- Generate random contact metadata (tags, colors, mixed valid/invalid) → verify TagInput and ColorPicker handle all inputs without crashing
- Generate random viewport widths → verify responsive layout doesn't break in any language
- Generate random translation key subsets → verify `t()` function never returns undefined or throws

### Integration Tests

- Test full page navigation flow in each language: switch language → navigate all routes → verify no untranslated content
- Test contact CRUD with tags and colors: create contact → add tags → assign color → verify persistence → edit → delete tag → verify removal
- Test language switch during active session: start in English → switch to Farsi mid-page → verify layout flips and content translates without page reload
- Test interactive UI contracts across dashboard pages: keyboard/state behavior, accessible modal focus behavior, toast announcement/dismissal, and logical RTL popup alignment; complete browser visual checks at desktop and mobile viewports
