/**
 * Reader typography and layout appearance preferences persisted in `localStorage`.
 */

import { createSignal, flush } from 'solid-js';
import { getItem, removeItem, setItem } from './storage';

export const APPEARANCE_STORAGE_KEY = 'reader.appearance';
const THEME_STORAGE_KEY = 'reader.theme';

export type ReaderTheme = 'auto' | 'light' | 'dark';
export type ReaderFontSize = 'sm' | 'md' | 'lg' | 'xl';
export type ReaderFontFamily = 'sans' | 'serif';
export type ReaderLineHeight = 'compact' | 'medium' | 'relaxed';
export type ReaderLineWidth = 'narrow' | 'medium' | 'wide';

export interface ReaderAppearance {
  fontSize: ReaderFontSize;
  fontFamily: ReaderFontFamily;
  lineWidth: ReaderLineWidth;
  lineHeight: ReaderLineHeight;
}

const FONT_SIZES: ReadonlyArray<ReaderFontSize> = ['sm', 'md', 'lg', 'xl'];
const FONT_FAMILIES: ReadonlyArray<ReaderFontFamily> = ['sans', 'serif'];
const LINE_HEIGHTS: ReadonlyArray<ReaderLineHeight> = [
  'compact',
  'medium',
  'relaxed',
];
const LINE_WIDTHS: ReadonlyArray<ReaderLineWidth> = [
  'narrow',
  'medium',
  'wide',
];
const THEMES: ReadonlyArray<ReaderTheme> = ['auto', 'light', 'dark'];

export const DEFAULT_APPEARANCE: ReaderAppearance = {
  fontSize: 'md',
  fontFamily: 'sans',
  lineWidth: 'wide',
  lineHeight: 'medium',
};

const pickAllowed = <T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T
): T =>
  typeof value === 'string' &&
  (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeAppearance = (
  raw: unknown,
  fallback: ReaderAppearance = DEFAULT_APPEARANCE
): ReaderAppearance => {
  if (!isPlainRecord(raw)) return { ...fallback };

  return {
    fontSize: pickAllowed(raw.fontSize, FONT_SIZES, fallback.fontSize),
    fontFamily: pickAllowed(raw.fontFamily, FONT_FAMILIES, fallback.fontFamily),
    lineWidth: pickAllowed(raw.lineWidth, LINE_WIDTHS, fallback.lineWidth),
    lineHeight: pickAllowed(raw.lineHeight, LINE_HEIGHTS, fallback.lineHeight),
  };
};

function loadAppearance(): ReaderAppearance {
  const raw = getItem(APPEARANCE_STORAGE_KEY);
  if (raw === null) return { ...DEFAULT_APPEARANCE };

  try {
    return normalizeAppearance(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

const persistAppearance = (next: ReaderAppearance): void => {
  setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
};

const removePersistedAppearance = (): void => {
  removeItem(APPEARANCE_STORAGE_KEY);
};

const [readerAppearance, setReaderAppearance] = createSignal<ReaderAppearance>(
  loadAppearance()
);

export { readerAppearance };

export const updateReaderAppearance = (
  patch: Partial<ReaderAppearance>
): void => {
  const next = normalizeAppearance(patch, readerAppearance());
  setReaderAppearance(next);
  persistAppearance(next);
  flush();
};

export const resetReaderAppearance = (): void => {
  setReaderAppearance({ ...DEFAULT_APPEARANCE });
  removePersistedAppearance();
  setReaderTheme('auto');
};

const applyTheme = (next: ReaderTheme): void => {
  if (next === 'auto') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = next;
  }
};

const loadTheme = (): ReaderTheme => {
  const theme = pickAllowed(getItem(THEME_STORAGE_KEY), THEMES, 'auto');
  if (theme !== 'auto') applyTheme(theme);
  return theme;
};

const persistTheme = (next: ReaderTheme): void => {
  setItem(THEME_STORAGE_KEY, next);
};

const [readerTheme, setReaderThemeSignal] = createSignal<ReaderTheme>(
  loadTheme()
);

export { readerTheme };

export const setReaderTheme = (next: ReaderTheme): void => {
  setReaderThemeSignal(next);
  persistTheme(next);
  applyTheme(next);
  flush();
};

const [readerFullscreen, setReaderFullscreen] = createSignal(false);

export { readerFullscreen };

export const toggleReaderFullscreen = (): void => {
  setReaderFullscreen((prev) => !prev);
};

export const isDefaultAppearance = (): boolean => {
  const current = readerAppearance();
  return (
    current.fontSize === DEFAULT_APPEARANCE.fontSize &&
    current.fontFamily === DEFAULT_APPEARANCE.fontFamily &&
    current.lineWidth === DEFAULT_APPEARANCE.lineWidth &&
    current.lineHeight === DEFAULT_APPEARANCE.lineHeight
  );
};
