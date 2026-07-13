'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'next/navigation';
import {
  getThemeEntry,
  resolveInitialThemeId,
  syncThemeQueryParam,
  writeStoredThemeId,
  type ThemeId,
} from '@/themes';
import {
  LandingThemeContext,
  type ColorMode,
} from '@/hooks/use-landing-theme';

interface LandingThemeProviderProps {
  children: ReactNode;
}

export function LandingThemeProvider({ children }: LandingThemeProviderProps) {
  const searchParams = useSearchParams();
  const search = searchParams.toString()
    ? `?${searchParams.toString()}`
    : typeof window !== 'undefined'
      ? window.location.search
      : '';

  const [themeId, setThemeIdState] = useState<ThemeId>(() =>
    resolveInitialThemeId(search),
  );
  const [colorMode, setColorMode] = useState<ColorMode>('system');

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    writeStoredThemeId(id);
    syncThemeQueryParam(id);
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove('dark');
    return () => {
      document.documentElement.classList.add('dark');
    };
  }, []);

  useEffect(() => {
    const fromUrl = resolveInitialThemeId(window.location.search);
    if (fromUrl !== themeId) {
      setThemeIdState(fromUrl);
      writeStoredThemeId(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const activeTheme = useMemo(() => getThemeEntry(themeId), [themeId]);

  const value = useMemo(
    () => ({
      themeId,
      activeTheme,
      colorMode,
      setThemeId,
      setColorMode,
    }),
    [themeId, activeTheme, colorMode, setThemeId],
  );

  return (
    <LandingThemeContext.Provider value={value}>
      {children}
    </LandingThemeContext.Provider>
  );
}
