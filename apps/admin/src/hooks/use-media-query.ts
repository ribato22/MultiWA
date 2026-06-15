'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe media query hook.
 *
 * @param query Standard media query, e.g. '(min-width: 768px)'
 * @param ssrDefault What to return during SSR / first paint before mount.
 *   Default `true` (assume desktop) to prevent layout flash on initial render
 *   for desktop users — mobile users see a one-frame flash, which is acceptable.
 */
export function useMediaQuery(query: string, ssrDefault: boolean = true): boolean {
  const [matches, setMatches] = useState<boolean>(ssrDefault);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/** Convenience: returns true when viewport ≥ md (768px) */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}

/** Convenience: returns true when viewport ≥ lg (1024px) */
export function useIsLargeDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}
