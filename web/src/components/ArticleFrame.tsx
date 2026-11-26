import type { JSX } from '@solidjs/web';
import { createEffect, createMemo, createSignal, onSettled } from 'solid-js';
import { t } from '../i18n';
import {
  DEFAULT_APPEARANCE,
  type ReaderTheme,
  readerAppearance,
  readerTheme,
} from '../state';
import { buildReaderStyles, type ReaderTypography } from './articleFrameStyles';
import { ImageLightbox } from './ImageLightbox';

export interface ArticleFrameProps {
  html: string;
  title?: string;
}

export interface ArticleFrameResizeMessage {
  type: 'article-frame-resize';
  token: string;
  height: number;
}

export interface ArticleFrameImageMessage {
  type: 'article-frame-image';
  token: string;
  src: string;
  alt?: string;
}

export interface ArticleFrameKeyMessage {
  type: 'article-frame-key';
  token: string;
  key: 'Escape';
}

export interface ArticleSrcdocOptions {
  html: string;
  nonce: string;
  token: string;
  appOrigin: string;
  stylesheetHrefs?: ReadonlyArray<string>;
  appearance?: ReaderTypography;
  theme?: ReaderTheme;
  imageLabel?: string;
}

interface LightboxState {
  src: string;
  alt?: string;
}

interface FrameMessageHandlers {
  onResize: (height: number) => void;
  onImage: (image: LightboxState) => void;
  onEscape: () => void;
}

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const jsStringLiteral = (value: string): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/** Fresh unguessable value for the CSP nonce and the `postMessage` bridge token. */
const randomToken = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
};

/** `RD-FRAME-1`: stored source classes must not leak into the isolated document. */
const stripSourceClasses = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const element of Array.from(doc.querySelectorAll('[class]'))) {
    element.removeAttribute('class');
  }

  return doc.body.innerHTML;
};

const activeStylesheetHrefs = (): Array<string> => {
  const hrefs = new Set<string>();
  for (const link of Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  )) {
    const raw = link.getAttribute('href');
    if (!raw) continue;

    try {
      hrefs.add(new URL(raw, document.baseURI).href);
    } catch {
      // Ignore unparseable hrefs rather than breaking the frame.
    }
  }

  return [...hrefs];
};

const RESIZE_OBSERVER_SCRIPT = `
  function measure() {
    var body = document.body;
    var height = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0
    );
    if (typeof height !== 'number' || !isFinite(height) || height < 1) height = 1;
    window.parent.postMessage({ type: 'article-frame-resize', token: token, height: height }, '*');
  }
  function schedule() {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(measure);
    } else {
      window.setTimeout(measure, 0);
    }
  }
  window.addEventListener('load', measure);
  window.addEventListener('resize', schedule);
  document.addEventListener(
    'load',
    function (event) {
      var target = event.target;
      if (target && target.tagName === 'IMG') schedule();
    },
    true
  );
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(schedule).observe(document.body);
  }
  schedule();`;

const FRAME_INTERACTION_SCRIPT = `
  function postImage(img) {
    var src = img.currentSrc || img.getAttribute('src') || '';
    if (!/^https?:\\/\\//i.test(src)) return false;
    window.parent.postMessage({ type: 'article-frame-image', token: token, src: src, alt: img.getAttribute('alt') || '' }, '*');
    return true;
  }
  function enhanceImages() {
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.closest('a[href]')) continue;
      var src = img.currentSrc || img.getAttribute('src') || '';
      if (/^https?:\\/\\//i.test(src) && !img.hasAttribute('tabindex')) {
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        if (!(img.getAttribute('alt') || '').trim() && !img.hasAttribute('aria-label')) {
          img.setAttribute('aria-label', imageLabel);
        }
      }
    }
  }
  window.addEventListener('load', enhanceImages);
  enhanceImages();
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && target.tagName === 'IMG' && !target.closest('a[href]')) {
      if (postImage(target)) event.preventDefault();
    }
  });
  document.addEventListener('keydown', function (event) {
    var target = event.target;
    if (event.key === 'Escape') {
      window.parent.postMessage({ type: 'article-frame-key', token: token, key: 'Escape' }, '*');
      return;
    }
    if (target && target.tagName === 'IMG' && !target.closest('a[href]') && (event.key === 'Enter' || event.key === ' ')) {
      if (postImage(target)) {
        event.preventDefault();
        return;
      }
    }
  });`;

const buildFrameScript = (
  token: string,
  imageLabel: string
): string => `(function () {
  var token = ${jsStringLiteral(token)};
  var imageLabel = ${jsStringLiteral(imageLabel)};${RESIZE_OBSERVER_SCRIPT}${FRAME_INTERACTION_SCRIPT}
})();`;

const messageRecord = (
  data: unknown,
  expectedToken: string,
  expectedType: string
): Record<string, unknown> | null => {
  if (typeof expectedToken !== 'string' || expectedToken.length === 0) {
    return null;
  }

  if (data === null || typeof data !== 'object') return null;

  const record = data as Record<string, unknown>;
  if (record.type !== expectedType || record.token !== expectedToken) {
    return null;
  }

  return record;
};

export const isValidResizeMessage = (
  data: unknown,
  expectedToken: string
): data is ArticleFrameResizeMessage => {
  const record = messageRecord(data, expectedToken, 'article-frame-resize');
  if (!record || typeof record.height !== 'number') return false;
  if (!Number.isFinite(record.height)) return false;

  return record.height >= 1 && record.height <= 1_000_000;
};

export const isValidImageMessage = (
  data: unknown,
  expectedToken: string
): data is ArticleFrameImageMessage => {
  const record = messageRecord(data, expectedToken, 'article-frame-image');
  if (!record || typeof record.src !== 'string') return false;
  if (!/^https?:\/\//i.test(record.src)) return false;

  return record.alt === undefined || typeof record.alt === 'string';
};

export const isValidKeyMessage = (
  data: unknown,
  expectedToken: string
): data is ArticleFrameKeyMessage => {
  const record = messageRecord(data, expectedToken, 'article-frame-key');

  return record !== null && record.key === 'Escape';
};

export const buildArticleSrcdoc = (options: ArticleSrcdocOptions): string => {
  const appOrigin = options.appOrigin ? ` ${options.appOrigin}` : '';
  const csp =
    `default-src 'none'; img-src https: http:; style-src 'unsafe-inline'${appOrigin}; ` +
    `script-src 'nonce-${options.nonce}'; base-uri 'none'; form-action 'none'`;

  const stylesheets = (options.stylesheetHrefs ?? [])
    .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
    .join('');

  const styles = buildReaderStyles(options.appearance ?? DEFAULT_APPEARANCE);
  const imageLabel = options.imageLabel ?? t('reader.imagePreview');
  const htmlTag =
    options.theme && options.theme !== 'auto'
      ? `<html data-theme="${escapeAttribute(options.theme)}">`
      : '<html>';

  return [
    '<!DOCTYPE html>',
    htmlTag,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    stylesheets,
    `<style>${styles}</style>`,
    '</head>',
    `<body>${stripSourceClasses(options.html)}`,
    `<script nonce="${escapeAttribute(options.nonce)}">${buildFrameScript(options.token, imageLabel)}</script>`,
    '</body>',
    '</html>',
  ].join('');
};

const dispatchFrameMessage = (
  data: unknown,
  token: string,
  handlers: FrameMessageHandlers
): void => {
  if (isValidResizeMessage(data, token)) {
    handlers.onResize(Math.ceil(data.height));

    return;
  }

  if (isValidImageMessage(data, token)) {
    handlers.onImage({ src: data.src, alt: data.alt });

    return;
  }

  if (isValidKeyMessage(data, token)) {
    handlers.onEscape();
  }
};

const useFrameMessages = (
  getIframe: () => HTMLIFrameElement | undefined,
  getToken: () => string,
  handlers: FrameMessageHandlers
): void => {
  onSettled(() => {
    const onMessage = (event: MessageEvent) => {
      const iframe = getIframe();
      if (!iframe || event.source !== iframe.contentWindow) return;

      dispatchFrameMessage(event.data, getToken(), handlers);
    };

    window.addEventListener('message', onMessage);

    return () => window.removeEventListener('message', onMessage);
  });
};

const createFrameContent = (html: () => string) => {
  const fontSize = createMemo(() => readerAppearance().fontSize);
  const fontFamily = createMemo(() => readerAppearance().fontFamily);
  const lineHeight = createMemo(() => readerAppearance().lineHeight);

  return createMemo(() => {
    const nonce = randomToken();
    const token = randomToken();

    return {
      token,
      srcdoc: buildArticleSrcdoc({
        html: html(),
        nonce,
        token,
        appOrigin: window.location.origin,
        stylesheetHrefs: activeStylesheetHrefs(),
        appearance: {
          fontSize: fontSize(),
          fontFamily: fontFamily(),
          lineHeight: lineHeight(),
        },
        theme: readerTheme(),
        imageLabel: t('reader.imagePreview'),
      }),
    };
  });
};

/**
 * `RD-FRAME-1`: sanitized article HTML in an isolated `srcdoc` iframe without
 * `allow-same-origin`, linked to the app stylesheet, guarded by CSP, and
 * resized through a per-render random `postMessage` token.
 */
export function ArticleFrame(props: ArticleFrameProps): JSX.Element {
  let iframeRef: HTMLIFrameElement | undefined;
  const [height, setHeight] = createSignal<number | undefined>(undefined);
  const [lightbox, setLightbox] = createSignal<LightboxState | null>(null);
  const frame = createFrameContent(() => props.html);

  createEffect(
    () => props.html,
    () => {
      setLightbox(null);
      setHeight(undefined);
    }
  );

  useFrameMessages(
    () => iframeRef,
    () => frame().token,
    {
      onResize: setHeight,
      onImage: setLightbox,
      onEscape: () => setLightbox(null),
    }
  );

  return (
    <>
      <iframe
        ref={(element) => {
          iframeRef = element;
        }}
        title={props.title ?? ''}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerpolicy="no-referrer"
        srcdoc={frame().srcdoc}
        style={height() === undefined ? undefined : `height: ${height()}px`}
        class={
          height() === undefined
            ? 'w-full min-h-[200px] border-0 bg-base-100'
            : 'w-full border-0 bg-base-100'
        }
      />
      <ImageLightbox
        src={lightbox()?.src ?? null}
        alt={lightbox()?.alt}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}
