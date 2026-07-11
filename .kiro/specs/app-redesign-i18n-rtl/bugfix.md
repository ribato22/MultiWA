# Bugfix Requirements Document

## Introduction

The MultiWA admin dashboard has multiple deficiencies affecting internationalization, accessibility, visual design, and contact management. The application currently lacks complete Farsi language support across all pages, does not properly handle RTL layout for Persian content, uses the wrong font family (Inter instead of Lalezar), is missing contact tagging/color-grouping UI, and has an outdated visual design that should be rebuilt with the facebook/astryx component library. These issues collectively make the application unusable for Farsi-speaking users and fail to meet the desired UX quality bar.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the language is set to Farsi THEN the system only translates navigation and header labels, leaving all page content, forms, buttons, error messages, and dashboard widgets in English

1.2 WHEN the language is set to Farsi THEN the system sets `dir="rtl"` on the HTML element but the sidebar, cards, tables, chat bubbles, and page layouts do not mirror correctly (icons stay on the wrong side, margins/paddings are not flipped, text alignment remains left-aligned)

1.3 WHEN the application loads THEN the system renders text in the Inter font instead of the Lalezar font for both Farsi and English content

1.4 WHEN a user navigates to the Contacts page THEN the system does not provide a UI to add, edit, or remove hashtags/tags on individual contacts

1.5 WHEN a user navigates to the Contacts page THEN the system does not provide a UI to assign colors to contacts or filter/group contacts by color

1.6 WHEN the application renders any page (landing, auth, dashboard, settings) THEN the system uses outdated shadcn/ui components and styling that do not meet the desired modern design standard

1.7 WHEN the user selects Indonesian or English THEN the system provides those languages, but there is no Arabic language option which is one of the three required supported languages

### Expected Behavior (Correct)

2.1 WHEN the language is set to Farsi THEN the system SHALL display all UI text (page titles, form labels, buttons, placeholders, error messages, table headers, tooltips, empty states, and dashboard widgets) in Farsi

2.2 WHEN the language is set to Farsi (or any RTL language) THEN the system SHALL mirror the entire layout correctly — sidebar appears on the right, text aligns to the right, margins/paddings flip, directional icons reverse, and chat bubbles position on the correct side

2.3 WHEN the application loads THEN the system SHALL render all text using the Lalezar font family for both Farsi and English (and Arabic) content across all pages

2.4 WHEN a user navigates to the Contacts page THEN the system SHALL provide a UI to add, edit, and remove hashtags/tags on individual contacts, with inline tag input and autocomplete from existing tags

2.5 WHEN a user navigates to the Contacts page THEN the system SHALL provide a UI to assign a color to each contact and to filter/group the contacts list by color

2.6 WHEN the application renders any page THEN the system SHALL use the facebook/astryx UI component library with a modern, clean design language applied consistently from the landing page through all dashboard pages

2.7 WHEN the user opens the language selector THEN the system SHALL offer three language options: English, Farsi (فارسی), and Arabic (العربية), with full translation coverage for all three

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the language is set to English THEN the system SHALL CONTINUE TO display all English content correctly with LTR layout and proper alignment

3.2 WHEN a user manages WhatsApp profiles (connect, disconnect, send messages, view QR) THEN the system SHALL CONTINUE TO function identically regardless of the selected language or UI redesign

3.3 WHEN a user uses the broadcast, automation, templates, or webhook features THEN the system SHALL CONTINUE TO operate with the same functionality and API behavior

3.4 WHEN a user accesses the application on mobile devices THEN the system SHALL CONTINUE TO provide responsive layouts with proper touch targets and safe area handling

3.5 WHEN existing contacts have tags and color metadata stored THEN the system SHALL CONTINUE TO preserve and correctly display that existing data after the UI update

3.6 WHEN a user authenticates (login/register) THEN the system SHALL CONTINUE TO use the same authentication flow and session management
