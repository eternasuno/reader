import type { ReaderFontFamily } from '../state';

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
