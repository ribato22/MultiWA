import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from './registry';

export const LANDING_THEME_STORAGE_KEY = 'multiwa-landing-theme';

export function readStoredThemeId(): ThemeId | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(LANDING_THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredThemeId(id: ThemeId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANDING_THEME_STORAGE_KEY, id);
  } catch {
    // Ignore quota / privacy errors.
  }
}

export function getThemeIdFromSearch(search: string): ThemeId | null {
  const params = new URLSearchParams(search);
  const value = params.get('theme');
  return isThemeId(value) ? value : null;
}

export function resolveInitialThemeId(search: string): ThemeId {
  return getThemeIdFromSearch(search) ?? readStoredThemeId() ?? DEFAULT_THEME_ID;
}

export function syncThemeQueryParam(id: ThemeId): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('theme', id);
  window.history.replaceState({}, '', url.toString());
}
