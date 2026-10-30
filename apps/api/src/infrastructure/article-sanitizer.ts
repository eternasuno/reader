import createDOMPurify from 'dompurify';
import type { JSDOM } from 'jsdom';

const allowedTags = [
  'p',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'img',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'del',
  's',
  'br',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'sup',
  'sub',
  'time',
];

const allowedAttributes = [
  'href',
  'src',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'datetime',
];

const isSafeUrl = (url: URL) =>
  (url.protocol === 'http:' || url.protocol === 'https:') &&
  !url.username &&
  !url.password;

const resolveAttribute = (
  element: Element,
  attribute: string,
  base: string
) => {
  try {
    const url = new URL(element.getAttribute(attribute) ?? '', base);
    if (!isSafeUrl(url)) {
      throw new Error('Unsafe URL');
    }

    element.setAttribute(attribute, url.href);
  } catch {
    element.removeAttribute(attribute);
  }
};

const hardenLink = (element: Element) => {
  element.setAttribute('target', '_blank');
  element.setAttribute('rel', 'noopener noreferrer');
};

const hardenImage = (element: Element) => {
  element.setAttribute('loading', 'lazy');
  element.setAttribute('referrerpolicy', 'no-referrer');
};

const normalizeElement = (element: Element, base: string) => {
  if (element.tagName === 'A') {
    resolveAttribute(element, 'href', base);
    hardenLink(element);

    return;
  }

  if (element.tagName === 'IMG') {
    resolveAttribute(element, 'src', base);
    hardenImage(element);
  }
};

const normalizeUrls = (document: Document, base: string) => {
  for (const element of document.querySelectorAll('a[href], img[src]')) {
    normalizeElement(element, base);
  }
};

export const cleanArticle = (dom: JSDOM, content: string, base: string) => {
  const purifier = createDOMPurify(dom.window);
  const clean = purifier.sanitize(content, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOW_DATA_ATTR: false,
  });
  dom.window.document.body.innerHTML = clean;
  normalizeUrls(dom.window.document, base);
};
