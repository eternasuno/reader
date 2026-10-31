import createDOMPurify from 'dompurify';
import { Effect, Layer } from 'effect';
import { JSDOM } from 'jsdom';
import {
  ContentProcessError,
  ContentProcessor,
} from '../../../../packages/business/src/port/content-processor.ts';
import { cleanArticle } from '../infrastructure/article-sanitizer';

const MAX_CONTENT_LENGTH = 100_000;

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

const hasScheme = (value: string) => /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);

const isSafeAttributeUrl = (value: string) => {
  if (!hasScheme(value.trim())) {
    return true;
  }

  try {
    return isSafeUrl(new URL(value.trim()));
  } catch {
    return false;
  }
};

const keepSafeAttribute = (element: Element, attribute: string) => {
  const value = element.getAttribute(attribute);
  if (value !== null && isSafeAttributeUrl(value)) {
    return;
  }

  element.removeAttribute(attribute);
};

const hardenLink = (element: Element) => {
  element.setAttribute('target', '_blank');
  element.setAttribute('rel', 'noopener noreferrer');
};

const hardenImage = (element: Element) => {
  element.setAttribute('loading', 'lazy');
  element.setAttribute('referrerpolicy', 'no-referrer');
};

const normalizeRawUrls = (document: Document) => {
  for (const element of document.querySelectorAll('a[href], img[src]')) {
    const attribute = element.tagName === 'A' ? 'href' : 'src';
    keepSafeAttribute(element, attribute);

    if (element.tagName === 'A') {
      hardenLink(element);
    } else {
      hardenImage(element);
    }
  }
};

const cleanRawArticle = (dom: JSDOM, content: string) => {
  const purifier = createDOMPurify(dom.window);
  const clean = purifier.sanitize(content, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOW_DATA_ATTR: false,
  });
  dom.window.document.body.innerHTML = clean;
  normalizeRawUrls(dom.window.document);
};

const sanitize = (content: string, text: boolean, base: string | undefined) => {
  const dom = base === undefined ? new JSDOM('') : new JSDOM('', { url: base });

  try {
    const document = dom.window.document;
    const value = content.slice(0, MAX_CONTENT_LENGTH);
    if (text) {
      document.body.textContent = value;
    }

    const source = text ? document.body.innerHTML : value;
    if (base === undefined) {
      cleanRawArticle(dom, source);
    } else {
      cleanArticle(dom, source, base);
    }

    return document.body.innerHTML;
  } finally {
    dom.window.close();
  }
};

export const processContent = (content: string, text: boolean, url?: URL) =>
  sanitize(content, text, url?.href);

export const ContentProcessorLive = Layer.succeed(ContentProcessor, {
  process: (content, text, url) =>
    Effect.try({
      try: () => processContent(content, text, url),
      catch: () =>
        new ContentProcessError({
          message: 'Failed to sanitize article content',
        }),
    }),
});
