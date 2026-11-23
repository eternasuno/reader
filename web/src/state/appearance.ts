/**
 * Reader typography and layout appearance preferences persisted in `localStorage`.
 */

import { createSignal, flush } from 'solid-js';
import { getItem, removeItem, setItem } from './storage';

export const APPEARANCE_STORAGE_KEY = 'reader.appearance';
export const THEME_STORAGE_KEY = 'reader.theme';

export type ReaderTheme = 'auto' | 'light' | 'dark';
export type ReaderFontSize = 14 | 16 | 18 | 20 | 22;
export type ReaderFontFamily = 'sans' | 'serif';
export type ReaderLineHeight = 1.4 | 1.6 | 1.8 | 2.0;
export type ReaderLineWidth = 1 | 2 | 3 | 4 | 5 | 6;

export interface ReaderAppearance {
  fontSize: ReaderFontSize;
  fontFamily: ReaderFontFamily;
  lineWidth: ReaderLineWidth;
  lineHeight: ReaderLineHeight;
}

export interface ReaderAppearanceInput {
  fontSize?: ReaderFontSize | 'sm' | 'md' | 'lg' | 'xl';
  fontFamily?: ReaderFontFamily;
  lineWidth?: ReaderLineWidth | 'narrow' | 'standard' | 'wide';
  lineHeight?: ReaderLineHeight | 'compact' | 'comfortable' | 'relaxed';
}

export const FONT_SIZE_STEPS: ReadonlyArray<ReaderFontSize> = [
  14, 16, 18, 20, 22,
];
export const LINE_HEIGHT_STEPS: ReadonlyArray<ReaderLineHeight> = [
  1.4, 1.6, 1.8, 2.0,
];
export const LINE_WIDTH_STEPS: ReadonlyArray<ReaderLineWidth> = [
  1, 2, 3, 4, 5, 6,
];

export const DEFAULT_APPEARANCE: ReaderAppearance = {
  fontSize: 16,
  fontFamily: 'sans',
  lineWidth: 6,
  lineHeight: 1.8,
};

const FONT_FAMILIES: ReadonlyArray<ReaderFontFamily> = ['sans', 'serif'];
const THEMES: ReadonlyArray<ReaderTheme> = ['auto', 'light', 'dark'];

const LEGACY_FONT_SIZES = new Map<string, ReaderFontSize>([
  ['sm', 14],
  ['md', 16],
  ['lg', 18],
  ['xl', 20],
]);

const LEGACY_LINE_HEIGHTS = new Map<string, ReaderLineHeight>([
  ['compact', 1.6],
  ['comfortable', 1.8],
  ['relaxed', 2.0],
]);

const LEGACY_LINE_WIDTHS = new Map<string, ReaderLineWidth>([
  ['narrow', 2],
  ['standard', 4],
  ['wide', 6],
]);

const pickAllowed = <T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T
): T =>
  typeof value === 'string' &&
  (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback;

const pickStep = <T extends number>(
  value: unknown,
  steps: ReadonlyArray<T>,
  legacy: ReadonlyMap<string, T>,
  fallback: T
): T => {
  if (
    typeof value === 'number' &&
    (steps as ReadonlyArray<number>).includes(value)
  ) {
    return value as T;
  }
  if (typeof value === 'string') {
    const mapped = legacy.get(value);
    if (mapped !== undefined) return mapped;
  }
  return fallback;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeAppearance = (
  raw: unknown,
  fallback: ReaderAppearance = DEFAULT_APPEARANCE
): ReaderAppearance => {
  if (!isPlainRecord(raw)) return { ...fallback };

  return {
    fontSize: pickStep(
      raw.fontSize,
      FONT_SIZE_STEPS,
      LEGACY_FONT_SIZES,
      fallback.fontSize
    ),
    fontFamily: pickAllowed(raw.fontFamily, FONT_FAMILIES, fallback.fontFamily),
    lineWidth: pickStep(
      raw.lineWidth,
      LINE_WIDTH_STEPS,
      LEGACY_LINE_WIDTHS,
      fallback.lineWidth
    ),
    lineHeight: pickStep(
      raw.lineHeight,
      LINE_HEIGHT_STEPS,
      LEGACY_LINE_HEIGHTS,
      fallback.lineHeight
    ),
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

export const updateReaderAppearance = (patch: ReaderAppearanceInput): void => {
  const current = readerAppearance();
  const next = normalizeAppearance(patch, current);
  setReaderAppearance(next);
  persistAppearance(next);
  flush();
};

const stepValue = <T extends number>(
  current: T,
  steps: ReadonlyArray<T>,
  delta: -1 | 1
): T | undefined => {
  const index = steps.indexOf(current);
  return index < 0 ? steps[0] : steps[index + delta];
};

export const stepFontSize = (delta: -1 | 1): void => {
  const next = stepValue(readerAppearance().fontSize, FONT_SIZE_STEPS, delta);
  if (next !== undefined) updateReaderAppearance({ fontSize: next });
};

export const stepLineHeight = (delta: -1 | 1): void => {
  const next = stepValue(
    readerAppearance().lineHeight,
    LINE_HEIGHT_STEPS,
    delta
  );
  if (next !== undefined) updateReaderAppearance({ lineHeight: next });
};

export const stepLineWidth = (delta: -1 | 1): void => {
  const next = stepValue(readerAppearance().lineWidth, LINE_WIDTH_STEPS, delta);
  if (next !== undefined) updateReaderAppearance({ lineWidth: next });
};

export const resetReaderAppearance = (): void => {
  setReaderAppearance({ ...DEFAULT_APPEARANCE });
  removePersistedAppearance();
  setReaderTheme('auto');
};

const applyTheme = (next: ReaderTheme): void => {
  if (typeof document === 'undefined') return;
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

export { readerFullscreen, setReaderFullscreen };

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
