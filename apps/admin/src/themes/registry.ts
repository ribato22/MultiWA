import type { DefinedTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { butterTheme } from '@astryxdesign/theme-butter/built';
import { chocolateTheme } from '@astryxdesign/theme-chocolate/built';
import { matchaTheme } from '@astryxdesign/theme-matcha/built';
import { stoneTheme } from '@astryxdesign/theme-stone/built';
import { gothicTheme } from '@astryxdesign/theme-gothic/built';
import { y2kTheme } from '@astryxdesign/theme-y2k/built';

export type ThemeId =
  | 'neutral'
  | 'butter'
  | 'chocolate'
  | 'matcha'
  | 'stone'
  | 'gothic'
  | 'y2k';

export interface ThemeEntry {
  id: ThemeId;
  label: string;
  description: string;
  keywords: string[];
  previewColors: [string, string, string];
  theme: DefinedTheme;
}

export const themes: Record<ThemeId, ThemeEntry> = {
  neutral: {
    id: 'neutral',
    label: 'Neutral',
    description: 'Restrained warm grays — minimal and quiet so content stays the focus.',
    keywords: ['minimal', 'saas', 'clean'],
    previewColors: ['#f5f3f0', '#78716c', '#292524'],
    theme: neutralTheme,
  },
  butter: {
    id: 'butter',
    label: 'Butter',
    description: 'Warm creamy yellows with a friendly blue accent — playful yet readable.',
    keywords: ['warm', 'consumer', 'friendly'],
    previewColors: ['#fef9c3', '#60a5fa', '#ca8a04'],
    theme: butterTheme,
  },
  chocolate: {
    id: 'chocolate',
    label: 'Chocolate',
    description: 'Rich browns with Fraunces headings — indulgent and editorial.',
    keywords: ['rich', 'editorial', 'warm'],
    previewColors: ['#3d2b1f', '#d4a574', '#f5e6d3'],
    theme: chocolateTheme,
  },
  matcha: {
    id: 'matcha',
    label: 'Matcha',
    description: 'Earthy greens with a calm, organic feel — wellness and content-first.',
    keywords: ['organic', 'wellness', 'natural'],
    previewColors: ['#ecfdf5', '#4ade80', '#166534'],
    theme: matchaTheme,
  },
  stone: {
    id: 'stone',
    label: 'Stone',
    description: 'Warm stone and slate — earthy, understated, and handcrafted.',
    keywords: ['earthy', 'craft', 'understated'],
    previewColors: ['#e7e5e4', '#78716c', '#44403c'],
    theme: stoneTheme,
  },
  gothic: {
    id: 'gothic',
    label: 'Gothic',
    description: 'Deep blue-grays with a dramatic display serif — editorial and memorable.',
    keywords: ['dramatic', 'editorial', 'serif'],
    previewColors: ['#1e293b', '#94a3b8', '#f1f5f9'],
    theme: gothicTheme,
  },
  y2k: {
    id: 'y2k',
    label: 'Y2K',
    description: 'Hot pinks, lime greens, and Poppins — bubbly, playful, unmistakably retro.',
    keywords: ['retro', 'playful', 'neon'],
    previewColors: ['#fce7f3', '#a3e635', '#ec4899'],
    theme: y2kTheme,
  },
};

export const THEME_IDS = Object.keys(themes) as ThemeId[];
export const DEFAULT_THEME_ID: ThemeId = 'neutral';

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return value != null && value in themes;
}

export function getThemeEntry(id: ThemeId): ThemeEntry {
  return themes[id];
}
