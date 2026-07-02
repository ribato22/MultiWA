'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import {
  LANGUAGE_OPTIONS,
  type Language,
  type MessageKey,
  type TextDirection,
  languageToDir,
  languageToHtmlLang,
  readStoredLanguage,
  translate,
} from './messages';

interface I18nContextValue {
  language: Language;
  dir: TextDirection;
  options: typeof LANGUAGE_OPTIONS;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    setLanguageState(readStoredLanguage());
  }, []);

  const dir = languageToDir(language);

  useEffect(() => {
    document.documentElement.lang = languageToHtmlLang(language);
    document.documentElement.dir = dir;
    document.body.dir = dir;
  }, [dir, language]);

  const value = useMemo<I18nContextValue>(() => {
    const setLanguage = (nextLanguage: Language) => {
      localStorage.setItem('multiwa.language', nextLanguage);
      setLanguageState(nextLanguage);
    };

    return {
      language,
      dir,
      options: LANGUAGE_OPTIONS,
      setLanguage,
      t: (key, params) => translate(language, key, params),
    };
  }, [dir, language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context) return context;
  return {
    language: 'en',
    dir: 'ltr',
    options: LANGUAGE_OPTIONS,
    setLanguage: () => undefined,
    t: (key, params) => translate('en', key, params),
  };
}
