'use client';

import { createContext, useContext } from 'react';
import type { ThemeEntry, ThemeId } from '@/themes';

export type ColorMode = 'light' | 'dark' | 'system';

export interface LandingThemeContextValue {
  themeId: ThemeId;
  activeTheme: ThemeEntry;
  colorMode: ColorMode;
  setThemeId: (id: ThemeId) => void;
  setColorMode: (mode: ColorMode) => void;
}

export const LandingThemeContext = createContext<LandingThemeContextValue | null>(
  null,
);

export function useLandingTheme(): LandingThemeContextValue {
  const value = useContext(LandingThemeContext);
  if (!value) {
    throw new Error('useLandingTheme must be used within LandingThemeProvider');
  }
  return value;
}
