import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { I18nProvider } from '@/lib/i18n/provider';
import type { Language } from '@/lib/i18n/messages';
import { LANGUAGE_STORAGE_KEY } from '@/lib/i18n/messages';

export function setTestLanguage(language: Language) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

export function renderWithI18n(
  ui: ReactElement,
  options?: RenderOptions & { language?: Language },
) {
  if (options?.language) {
    setTestLanguage(options.language);
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <I18nProvider>{children}</I18nProvider>;
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

/** Returns visible text nodes that look like English-only UI copy. */
export function findEnglishOnlyTextNodes(container: HTMLElement): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const englishPattern = /^[A-Za-z0-9\s.,'!?&:;()\-–—]+$/;
  const skipParents = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
  const leaks: string[] = [];

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.trim();
    if (!text || text.length < 2) continue;
    const parent = node.parentElement;
    if (!parent || skipParents.has(parent.tagName)) continue;
    if (englishPattern.test(text)) {
      leaks.push(text);
    }
  }
  return leaks;
}
