import createDOMPurify from 'dompurify';

const resolveAttribute = (
  element: Element,
  attribute: string,
  base: string | undefined
) => {
  if (base === undefined) {
    return;
  }

  try {
    element.setAttribute(
      attribute,
      new URL(element.getAttribute(attribute) ?? '', base).href
    );
  } catch {
    element.removeAttribute(attribute);
  }
};

const normalizeUrls = (document: Document, base: string | undefined) => {
  for (const element of document.body.querySelectorAll('a[href], img[src]')) {
    if (element.tagName === 'A') {
      resolveAttribute(element, 'href', base);
      element.setAttribute('target', '_blank');
    } else {
      resolveAttribute(element, 'src', base);
    }
  }
};

const baseUrl = (document: Document) =>
  document.URL === '' || document.URL === 'about:blank'
    ? undefined
    : document.URL;

export const cleanArticle = (document: Document, content: string) => {
  const view = document.defaultView;
  if (view === null) {
    throw new Error('Document has no default view');
  }

  const body = document.body;
  body.innerHTML = createDOMPurify(view).sanitize(content);
  normalizeUrls(document, baseUrl(document));
};
