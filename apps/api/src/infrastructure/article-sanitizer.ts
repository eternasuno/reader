import createDOMPurify from 'dompurify';

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

const keepAttribute = (element: Element, attribute: string) => {
  const value = element.getAttribute(attribute);
  if (value !== null && isSafeAttributeUrl(value)) {
    return;
  }

  element.removeAttribute(attribute);
};

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

const normalizeAttribute = (
  element: Element,
  attribute: string,
  base: string | undefined
) => {
  if (base === undefined) {
    keepAttribute(element, attribute);

    return;
  }

  resolveAttribute(element, attribute, base);
};

const normalizeElement = (element: Element, base: string | undefined) => {
  if (element.tagName === 'A') {
    normalizeAttribute(element, 'href', base);
    hardenLink(element);

    return;
  }

  if (element.tagName === 'IMG') {
    normalizeAttribute(element, 'src', base);
    hardenImage(element);
  }
};

const normalizeUrls = (document: Document, base: string | undefined) => {
  for (const element of document.querySelectorAll('a[href], img[src]')) {
    normalizeElement(element, base);
  }
};

const baseUrl = (document: Document) =>
  document.URL === '' || document.URL === 'about:blank'
    ? undefined
    : document.URL;

const createPurifier = (document: Document) => {
  const view = document.defaultView;
  if (view === null) {
    throw new Error('Document has no default view');
  }

  return createDOMPurify(view);
};

export const cleanArticle = (document: Document, content: string) => {
  const clean = createPurifier(document).sanitize(content, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOW_DATA_ATTR: false,
  });
  const body = document.body;
  body.innerHTML = clean;
  normalizeUrls(document, baseUrl(document));
};
