import {
  DEFAULT_APPEARANCE,
  type ReaderAppearance,
  type ReaderFontFamily,
} from '../state';

export type ReaderTypography = Pick<
  ReaderAppearance,
  'fontSize' | 'fontFamily' | 'lineHeight'
>;

/**
 * `RD-FRAME-1`: reader typography, explicit sans and serif stacks (no bare
 * `system-ui` on Linux), theme-aware surface and readable text via daisyUI CSS
 * variables. Latin fonts come before CJK fonts so Western punctuation such as
 * `’` keeps its proportional glyph instead of a full-width CJK one.
 */
const READER_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

const READER_SERIF_STACK =
  'Georgia, "Times New Roman", "Songti SC", "STSong", "Noto Serif CJK SC", "Noto Serif SC", serif';

const FONT_FAMILIES: Record<ReaderFontFamily, string> = {
  sans: READER_FONT_STACK,
  serif: READER_SERIF_STACK,
};

const READER_BASE_STYLES = `
html,
body {
  background: var(--color-base-100);
  color: var(--color-base-content);
}`;

const READER_ELEMENT_STYLES = `
p {
  margin: 0 0 1rem;
}
h1,
h2,
h3,
h4,
h5,
h6 {
  margin: 1.6em 0 0.6em;
  color: var(--color-base-content);
  font-weight: 600;
  line-height: 1.35;
}
h1 {
  font-size: 1.625rem;
}
h2 {
  font-size: 1.375rem;
}
h3 {
  font-size: 1.2rem;
}
h4,
h5,
h6 {
  font-size: 1.05rem;
}
a {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
a:hover,
a:focus {
  color: color-mix(in oklab, var(--color-primary) 80%, var(--color-base-content));
}
ul,
ol {
  margin: 0 0 1rem;
  padding-left: 1.5rem;
}
li {
  margin: 0.25em 0;
}
pre {
  margin: 1rem 0;
  padding: 0.85rem 1rem;
  overflow-x: auto;
  border: 1px solid var(--color-base-300);
  border-radius: 0.5rem;
  background: var(--color-base-200);
  color: var(--color-base-content);
  font-size: 0.875rem;
  line-height: 1.6;
}
code {
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  background: var(--color-base-200);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
}
pre code {
  padding: 0;
  background: transparent;
  font-size: inherit;
}
blockquote {
  margin: 1.25rem 0;
  padding: 0.5rem 1rem;
  border-left: 3px solid var(--color-primary);
  border-radius: 0 0.375rem 0.375rem 0;
  background: var(--color-base-200);
  color: color-mix(in oklab, var(--color-base-content) 80%, transparent);
}
img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 1rem auto;
  border-radius: 0.5rem;
  cursor: zoom-in;
}
a img {
  cursor: pointer;
}
figure {
  margin: 1rem 0;
}
figcaption {
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
  font-size: 0.8125rem;
  text-align: center;
}
table {
  width: 100%;
  margin: 1rem 0;
  border-collapse: collapse;
  font-size: 0.9375rem;
}
th,
td {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-base-300);
  text-align: left;
  vertical-align: top;
}
th {
  background: var(--color-base-200);
  font-weight: 600;
}
hr {
  margin: 1.5rem 0;
  border: 0;
  border-top: 1px solid var(--color-base-300);
}
iframe,
video,
svg {
  max-width: 100%;
}
`;

export const buildReaderStyles = (
  appearance: ReaderAppearance | ReaderTypography = DEFAULT_APPEARANCE
): string => `${READER_BASE_STYLES}
body {
  margin: 0;
  padding: 1.5rem 0 2rem;
  font-family: ${FONT_FAMILIES[appearance.fontFamily]};
  font-size: ${appearance.fontSize}px;
  line-height: ${appearance.lineHeight};
  overflow-wrap: anywhere;
  word-break: break-word;
}${READER_ELEMENT_STYLES}`;
