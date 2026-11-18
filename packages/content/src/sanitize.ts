import createDOMPurify from 'dompurify';

/** Resolves one URL attribute against the base, dropping it when it cannot be. */
const resolveAttribute = (
  element: Element,
  attribute: string,
  base: string
) => {
  try {
    const value = new URL(element.getAttribute(attribute) ?? '', base).href;

    element.setAttribute(attribute, value);
  } catch {
    element.removeAttribute(attribute);
  }
};

/** The URL relative links are resolved against, none for a document without one. */
const baseUrlOf = (document: Document): string | undefined => {
  const url = document.URL;

  return url === '' || url === 'about:blank' ? undefined : url;
};

/** Links leave the sandboxed reader frame (CM-HTML-3). */
const resolveLinks = (root: ParentNode, base: string | undefined) => {
  for (const link of root.querySelectorAll('a[href]')) {
    if (base !== undefined) {
      resolveAttribute(link, 'href', base);
    }

    link.setAttribute('target', '_blank');
  }
};

const resolveSources = (root: ParentNode, base: string | undefined) => {
  if (base === undefined) {
    return;
  }

  for (const image of root.querySelectorAll('img[src]')) {
    resolveAttribute(image, 'src', base);
  }
};

/**
 * Sanitizes HTML with DOMPurify defaults, resolved against the base of the
 * document and with links that leave the reader frame (CM-HTML-3). The window
 * of the document is the one DOMPurify sanitizes with, so the document must be
 * a live parsed document.
 */
export const sanitizeHtml = (document: Document, html: string): string => {
  const view = document.defaultView;

  if (view === null) {
    throw new Error('The sanitized document has no window');
  }

  const container = document.createElement('div');
  container.innerHTML = createDOMPurify(view).sanitize(html);

  const base = baseUrlOf(document);
  resolveLinks(container, base);
  resolveSources(container, base);

  return container.innerHTML;
};

/** Escapes plain text into HTML, so that a text field is shown literally. */
export const escapeText = (document: Document, text: string): string => {
  const element = document.createElement('span');
  element.textContent = text;

  return element.innerHTML;
};

/** A sanitized plain-text field, such as an excerpt (CM-ART-4). */
export const sanitizeText = (document: Document, text: string): string =>
  sanitizeHtml(document, escapeText(document, text));
