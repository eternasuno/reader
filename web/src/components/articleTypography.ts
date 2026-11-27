import type {
  ReaderFontFamily,
  ReaderFontSize,
  ReaderLineHeight,
} from '../state';

/**
 * `RD-BODY-1`: reader typography, explicit sans and serif stacks (no bare
 * `system-ui` on Linux). Latin fonts come before CJK fonts so Western
 * punctuation such as `’` keeps its proportional glyph instead of a full-width
 * CJK one.
 */
const READER_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

const READER_SERIF_STACK =
  'Georgia, "Times New Roman", "Songti SC", "STSong", "Noto Serif CJK SC", "Noto Serif SC", serif';

export const FONT_FAMILIES: Record<ReaderFontFamily, string> = {
  sans: READER_FONT_STACK,
  serif: READER_SERIF_STACK,
};

/** Font size tiers in `rem`, so the coarse-pointer root scale enlarges them too. */
export const FONT_SIZES: Record<ReaderFontSize, string> = {
  sm: '0.875rem',
  md: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
};

export const LINE_HEIGHTS: Record<ReaderLineHeight, string> = {
  compact: '1.6',
  medium: '1.8',
  relaxed: '2',
};
