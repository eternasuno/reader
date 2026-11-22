/**
 * `RD-FRAME-1`: fixed reader typography, explicit sans stack (no bare
 * `system-ui` on Linux), dark surface and readable text. Latin fonts come
 * before CJK fonts so Western punctuation such as `’` keeps its proportional
 * glyph instead of a full-width CJK one.
 */
const READER_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

export const READER_STYLES = `
:root {
  color-scheme: dark;
}
html,
body {
  background: #1e1e1e;
  color: #dddddf;
}
body {
  margin: 0;
  padding: 1.5rem 0 2rem;
  font-family: ${READER_FONT_STACK};
  font-size: 1rem;
  line-height: 1.75;
  overflow-wrap: anywhere;
  word-break: break-word;
}
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
  color: #f2f2f3;
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
  color: #d5a15c;
  text-decoration: underline;
  text-underline-offset: 2px;
}
a:hover,
a:focus {
  color: #e6bd85;
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
  border-radius: 0.5rem;
  background: #252525;
  color: #dddddf;
  font-size: 0.875rem;
  line-height: 1.6;
}
code {
  padding: 0.1em 0.35em;
  border-radius: 0.25rem;
  background: #252525;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
}
pre code {
  padding: 0;
  background: transparent;
  font-size: inherit;
}
blockquote {
  margin: 1rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
  border-left: 3px solid #d5a15c;
  color: #c7c7cb;
}
img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 1rem auto;
  border-radius: 0.5rem;
}
figure {
  margin: 1rem 0;
}
figcaption {
  color: #9a9aa0;
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
  border: 1px solid #343434;
  text-align: left;
  vertical-align: top;
}
th {
  background: #252525;
  font-weight: 600;
}
hr {
  margin: 1.5rem 0;
  border: 0;
  border-top: 1px solid #343434;
}
iframe,
video,
svg {
  max-width: 100%;
}
`;
