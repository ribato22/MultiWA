# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - i18n/RTL/Font/UI Deficiency Detection
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the seven bug conditions exist
  - **Scoped PBT Approach**: Generate random (language, page, interaction) tuples where `isBugCondition` holds and assert expected behavior
  - Test that rendering Dashboard/Contacts pages in Farsi (`fa`) produces no English-only text nodes (from Bug Condition C1.1 in design)
  - Test that rendering any page in Farsi results in sidebar positioned at `inset-inline-end` / right side (from Bug Condition C1.2)
  - Test that `getComputedStyle(body).fontFamily` includes "Lalezar" (from Bug Condition C1.3)
  - Test that Contacts page contains a `[data-testid="tag-input"]` element (from Bug Condition C1.4)
  - Test that Contacts page contains a `[data-testid="color-picker"]` and `[data-testid="color-filter"]` (from Bug Condition C1.5)
  - Test that no `@radix-ui` primitives are imported in rendered components (from Bug Condition C1.6)
  - Historical execution evidence only; import absence does not validate the current Requirement 2.6 contract.
  - Test that language selector includes Arabic (`ar`) as a valid option (from Bug Condition C1.7)
  - Run test on UNFIXED code - expect FAILURE (this confirms the bugs exist)
  - **EXPECTED OUTCOME**: Test FAILS — counterexamples include: stat cards in English when Farsi selected, sidebar has `left: 0` regardless of `dir="rtl"`, `fontFamily` returns "Inter", tag input element is null, Arabic not in language options
  - Document counterexamples found to confirm root cause analysis
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - English LTR Layout & Feature Stability
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: Render all pages in English (`en`) on unfixed code — verify LTR layout, left sidebar, left-aligned text, proper responsive breakpoints
  - Observe: Navigate WhatsApp profile flows (connect, QR view, disconnect) on unfixed code — verify all operations succeed
  - Observe: Exercise broadcast, automation, templates, webhook pages on unfixed code — verify functionality
  - Observe: Render pages at mobile viewport widths (375px, 390px, 414px) — verify responsive layout and touch targets ≥ 44px
  - Observe: Load contacts with existing tag/color metadata — verify data displays correctly
  - Observe: Run login/register flow — verify session creation and redirect
  - Write property-based tests capturing observed baseline:
    - For all pages rendered in English: layout direction is LTR, sidebar on left, text left-aligned (from Preservation Req 3.1)
    - For all WhatsApp profile operations: API responses and UI state match baseline (from Preservation Req 3.2)
    - For all broadcast/automation/template/webhook interactions: functionality and API behavior unchanged (from Preservation Req 3.3)
    - For random viewport widths ≥ 320px: responsive layout maintains touch targets and safe areas (from Preservation Req 3.4)
    - For all contacts with existing metadata: stored tags and colors render correctly (from Preservation Req 3.5)
    - For auth flows: session management and redirects work identically (from Preservation Req 3.6)
  - Verify all preservation tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 3. Implement i18n Catalog Expansion & Arabic Addition

  - [~] 3.1 Expand translation catalogs toward full coverage (~300+ keys)
    - Add translation keys for all pages: dashboard stats, form labels, buttons, placeholders, error messages, table headers, tooltips, empty states, widget titles
    - Cover pages: dashboard, contacts, profiles, chat, broadcast, automation, templates, webhooks, settings, analytics, audit, api-keys, integrations, knowledge
    - Add keys for common UI patterns: confirmation dialogs, loading states, success/error toasts, pagination, search
    - Farsi (`fa`) catalog coverage has expanded, but rendered coverage remains incomplete while component JSX still contains hardcoded strings
    - _Bug_Condition: isBugCondition C1.1 — language IN ['fa', 'ar'] AND pageHasUntranslatedStrings(page)_
    - _Expected_Behavior: allVisibleText(result).every(t => isInLanguage(t, input.language))_
    - _Preservation: English translations that are already correct must remain unchanged_
    - _Requirements: 1.1, 2.1_

  - [x] 3.2 Replace Indonesian with Arabic language mechanics
    - Change `Language` type from `'en' | 'fa' | 'id'` to `'en' | 'fa' | 'ar'`
    - Remove Indonesian (`id`) catalog entirely
    - Add Arabic (`ar`) catalog entries for implemented keys; this completion records locale mechanics, not full rendered Arabic coverage
    - Update `LANGUAGE_OPTIONS` to include `{ value: 'ar', label: 'Arabic', nativeLabel: 'العربية' }`
    - Update `languageToDir()` to return `'rtl'` for both `'fa'` and `'ar'`
    - Update `languageToHtmlLang()` to return `'ar'` for Arabic
    - Update `isLanguage()` to accept `'ar'` and reject `'id'`
    - _Bug_Condition: isBugCondition C1.7 — language == 'ar' AND NOT languageAvailable('ar')_
    - _Expected_Behavior: languageOptions(result).includes('ar')_
    - _Preservation: English and Farsi language mechanics unchanged_
    - _Requirements: 1.7, 2.7_

  - [-] 3.3 Replace all hardcoded English strings in component JSX with `t()` calls
    - Scan all component files for hardcoded English text in JSX
    - Replace with appropriate `t('namespace.key')` calls
    - Verify no English text leaks when language is set to Farsi or Arabic
    - _Bug_Condition: isBugCondition C1.1 — pageHasUntranslatedStrings(page)_
    - _Expected_Behavior: zero English fallback strings visible in RTL languages_
    - _Requirements: 1.1, 2.1, 2.7_

- [ ] 4. Implement RTL Layout with Logical CSS Properties

  - [~] 4.1 Replace physical CSS properties with logical equivalents
    - Replace `left`/`right` with `inset-inline-start`/`inset-inline-end` across all components
    - Replace `margin-left`/`margin-right` with `margin-inline-start`/`margin-inline-end`
    - Replace `padding-left`/`padding-right` with `padding-inline-start`/`padding-inline-end`
    - Replace `text-align: left`/`right` with `text-align: start`/`end`
    - Replace `rounded-bl-*`/`rounded-br-*` with logical equivalents using `[dir=rtl]` variants
    - _Bug_Condition: isBugCondition C1.2 — language IN ['fa', 'ar'] AND componentUsesPhysicalCSS(page)_
    - _Expected_Behavior: layoutDirection == 'rtl' AND all properties use logical values_
    - _Preservation: English LTR layout unaffected (logical properties work correctly for both directions)_
    - _Requirements: 1.2, 2.2, 3.1_

  - [~] 4.2 Fix sidebar and navigation RTL behavior
    - Update sidebar to use `inset-inline-start` positioning instead of `left: 0`
    - Replace `translateX(-100%)` mobile hide with `inset-inline-start`-based positioning
    - Add Tailwind `rtl:` variant utilities for directional icons (chevrons, arrows)
    - Ensure sidebar appears on right side in RTL mode
    - _Bug_Condition: sidebarPosition uses physical 'left' property_
    - _Expected_Behavior: sidebarPosition(result) == 'inline-end' in RTL_
    - _Requirements: 1.2, 2.2_

  - [~] 4.3 Fix chat bubbles and directional components
    - Update chat bubble tails to flip based on `dir` attribute
    - Fix sent-by-user bubbles to appear on inline-end side in RTL
    - Fix received bubbles to appear on inline-start side in RTL
    - Replace `rounded-br-sm`/`rounded-bl-sm` with direction-aware variants
    - _Bug_Condition: chat bubbles use hardcoded rounded corners and positioning_
    - _Expected_Behavior: chat bubbles position on correct side per direction_
    - _Requirements: 1.2, 2.2_

  - [~] 4.4 Add RTL-aware animation keyframes
    - Update slide animations to flip direction based on `dir` attribute
    - Ensure Framer Motion animations respect RTL layout
    - Add `rtl:` variant for transition origins
    - _Preservation: Animations in LTR mode unchanged_
    - _Requirements: 2.2, 3.1_

- [ ] 5. Implement Font Migration to Lalezar

  - [~] 5.1 Replace Inter font with Lalezar
    - Replace `Inter` import with `Lalezar` from `next/font/google` in `layout.tsx`
    - Configure subsets: `['latin', 'arabic']` to support English, Farsi, and Arabic
    - Update CSS variable from `--font-inter` to `--font-lalezar`
    - Update body className to use new font variable
    - Update Tailwind config `fontFamily` to use Lalezar as primary
    - _Bug_Condition: isBugCondition C1.3 — fontFamily(page) != 'Lalezar'_
    - _Expected_Behavior: fontFamily(result).includes('Lalezar')_
    - _Preservation: Font renders correctly for all three languages (Latin, Arabic, Persian scripts)_
    - _Requirements: 1.3, 2.3_

- [ ] 6. Implement Contact Tag Management UI

  - [~] 6.1 Create TagInput component with autocomplete
    - Create `src/components/contacts/TagInput.tsx`
    - Implement inline tag input consuming existing `parseTagInput()` utility
    - Add autocomplete from existing tags across all contacts
    - Support adding new tags with `#` prefix convention
    - Handle edge cases: empty string, duplicate tags, special characters
    - _Bug_Condition: isBugCondition C1.4 — page == 'contacts' AND interaction == 'manage_tags'_
    - _Expected_Behavior: tagInputExists(result) AND autocomplete works_
    - _Requirements: 1.4, 2.4_

  - [~] 6.2 Create TagChip component with edit/remove
    - Create `src/components/contacts/TagChip.tsx`
    - Implement colored tag badge using existing `getTagBadgeStyle()` utility
    - Add remove button (×) on each chip
    - Support inline editing of tag text
    - _Expected_Behavior: tagChipsRendered(result) with edit/remove capability_
    - _Requirements: 2.4_

  - [~] 6.3 Create ColorPicker component for contact color assignment
    - Create `src/components/contacts/ColorPicker.tsx`
    - Implement preset color palette picker (8-12 colors)
    - Allow assigning a single color to each contact
    - Wire mutation to API (PATCH contact metadata with color)
    - _Bug_Condition: isBugCondition C1.5 — interaction == 'assign_color'_
    - _Expected_Behavior: colorPickerExists(result) AND assignment persists_
    - _Requirements: 1.5, 2.5_

  - [~] 6.4 Create ColorFilter component for contact list filtering
    - Create `src/components/contacts/ColorFilter.tsx`
    - Implement filter dropdown using existing `collectTagColorFilters()` utility
    - Support filtering and grouping contacts by assigned color
    - Show color dot indicators in contact list rows
    - _Bug_Condition: isBugCondition C1.5 — interaction == 'filter_by_color'_
    - _Expected_Behavior: colorFilterExists(result) AND filtering works_
    - _Requirements: 1.5, 2.5_

  - [~] 6.5 Integrate tag and color components into Contacts page
    - Update contacts list page to show tag chips and color dots per contact
    - Update contacts detail/edit view to include TagInput and ColorPicker
    - Wire mutations to API for tag/color CRUD operations
    - Ensure existing contacts with stored tag/color metadata display correctly
    - _Preservation: Existing contacts with tags and color metadata preserved (Req 3.5)_
    - _Requirements: 2.4, 2.5, 3.5_

- [ ] 7. Complete interactive UI contracts

  - [~] 7.1 Complete Button, Input, and Card behavior
    - Use current local components and Tailwind tokens for visual consistency
    - Implement enabled Button single activation, disabled Button zero activation, and visible keyboard focus
    - Implement accessible Input naming, clear focus state, and RTL support
    - Keep Card readable at desktop and mobile widths
    - _Bug_Condition: isBugCondition C1.6 — interactiveControlsFailContract(page)_
    - _Expected_Behavior: Button disabled/activation/focus contract is satisfied_
    - _Requirements: 1.6, 2.6_

  - [~] 7.2 Complete Select, Menu, and Tabs interaction
    - Implement Select and Menu open/selected state with Arrow, Enter, Space, and Escape handling
    - Implement Tabs selected tab/active panel state with Arrow, Home, End, Enter, and Space handling
    - Implement logical inline popup positioning in RTL and LTR
    - _Expected_Behavior: interactive state and keyboard contracts are satisfied_
    - _Requirements: 1.6, 2.6_

  - [~] 7.3 Complete feedback and form interaction
    - Implement correct checked state and keyboard behavior for Checkbox and Switch
    - Implement Toast status announcement and user dismissal
    - Preserve semantic names for Badge and Avatar where needed
    - _Expected_Behavior: feedback is announced and controls communicate state_
    - _Requirements: 1.6, 2.6_

  - [~] 7.4 Complete Dialog, AlertDialog, and data components
    - Implement accessible names and descriptions for Dialog and AlertDialog
    - Implement modal focus containment while open, trigger focus restoration after close, and Escape close when dismissal is allowed
    - Keep Table and Skeleton readable with RTL-aware alignment
    - _Expected_Behavior: modal and data-component accessibility contracts are satisfied_
    - _Requirements: 1.6, 2.6_

  - [~] 7.5 Complete shared UI behavior without package-identity criteria
    - Use existing local components through public UI behavior
    - Do not use import paths, package presence, or UI-library identity as pass/fail evidence
    - _Expected_Behavior: every checked control satisfies its observable interaction contract_
    - _Requirements: 1.6, 2.6_

  - [~] 7.6 Apply consistent UI behavior across pages
    - Apply completed interaction contracts to landing, auth, and dashboard flows
    - Use logical RTL popup alignment and preserve user flows at desktop and mobile widths
    - _Expected_Behavior: consistent modern design from landing through dashboard_
    - _Preservation: Same functionality and user flows preserved (Req 3.2, 3.3, 3.6)_
    - _Requirements: 2.6, 3.2, 3.3, 3.6_

- [ ] 8. Implement Design Token Overhaul

  - [~] 8.1 Update CSS variables and color palette
    - Align CSS variables with dark-mode OLED palette: background `#0F172A`, card `#1E293B`, border `#334155`, text `#F8FAFC`, CTA `#22C55E`
    - Add spacing tokens as CSS variables (`--space-xs` 4px through `--space-3xl` 64px)
    - Add shadow depth tokens (`--shadow-sm` through `--shadow-xl`)
    - Maintain WhatsApp green accent as CTA color
    - _Preservation: Theme works correctly for all three languages_
    - _Requirements: 2.6_

  - [~] 8.2 Update Tailwind config for new design tokens
    - Map new CSS variables to Tailwind theme extensions
    - Add RTL-aware animation keyframes (slide directions flip with `dir`)
    - Ensure current local UI components consume new tokens
    - _Requirements: 2.6_

- [ ] 9. Fix verification

  - [~] 9.1 Verify bug condition and interactive UI contract checks
    - **Property 1: Expected Behavior** - i18n/RTL/Font/UI Deficiency Resolution
    - Re-run task-1 exploration checks for their recorded historical scope.
    - Add focused C1.6 checks for:
      - enabled Button one activation, disabled Button zero activation, and focus-visible state
      - Select and Menu Arrow, Enter, Space, and Escape behavior with open/selected state
      - Tabs Arrow, Home, End, Enter, and Space behavior with selected tab/active panel state
      - Dialog and AlertDialog accessible name/description, focus containment/restoration, and allowed Escape dismissal
      - Toast live-region announcement and user dismissal
      - LTR and RTL logical popup edge alignment
    - Record pass/fail per requirement; 9.1 cannot be completed until rendered i18n acceptance tracked by partial task 3.1 passes. Task 3.3 remains separate unfinished work.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [~] 9.2 Verify preservation tests still pass
    - **Property 2: Preservation** - English LTR Layout & Feature Stability
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix:
      - English LTR layout unchanged (Req 3.1)
      - WhatsApp profile management works (Req 3.2)
      - Broadcast/automation/templates/webhooks functional (Req 3.3)
      - Mobile responsive layouts preserved (Req 3.4)
      - Existing contact tag/color data displays (Req 3.5)
      - Auth flow unchanged (Req 3.6)

- [~] 10. Checkpoint - Complete behavior and browser verification
  - Run focused behavior checks for UI contracts and preservation flows
  - Verify bug condition checks cover all seven deficiencies through observable behavior, recording pass/fail for incomplete work
  - Verify preservation: English LTR layout, WhatsApp profile operations, broadcast/automation/templates/webhooks, mobile responsiveness, stored contact metadata, and authentication flows
  - Record desktop and mobile browser visual evidence at 1440px, 768px, and 375px viewports for English LTR and Farsi/Arabic RTL
  - At each viewport, inspect Button focus/disabled presentation, open Select/Menu and Tabs state, Dialog/AlertDialog focus behavior, Toast dismissal, and popup inline-edge alignment
  - Do not use package removal, import absence, or UI-library identity as verification criteria
