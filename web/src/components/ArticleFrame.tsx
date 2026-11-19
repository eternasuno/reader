import type { JSX } from '@solidjs/web';
import { createMemo, createSignal, onSettled } from 'solid-js';
import { READER_STYLES } from './articleFrameStyles';

export interface ArticleFrameProps {
  html: string;
  title?: string;
}

export interface ArticleFrameResizeMessage {
  type: 'article-frame-resize';
  token: string;
  height: number;
}

export interface ArticleSrcdocOptions {
  html: string;
  nonce: string;
  token: string;
  appOrigin: string;
  stylesheetHrefs?: ReadonlyArray<string>;
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

/** Fresh unguessable value for the CSP nonce and the resize-message token. */
const randomToken = (): string => {
  const source =
    typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto;

  if (source && typeof source.randomUUID === 'function') {
    return source.randomUUID().replace(/-/g, '');
  }

  if (source && typeof source.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);

    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    );
  }

  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

const currentOrigin = (): string => {
  if (typeof window === 'undefined') return '';
  return window.location?.origin ?? '';
};

/** `RD-FRAME-1`: stored source classes must not leak into the isolated document. */
export const stripSourceClasses = (html: string): string => {
  if (typeof DOMParser === 'undefined') {
    return html.replace(/\sclass\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const element of Array.from(doc.querySelectorAll('[class]'))) {
    element.removeAttribute('class');
  }

  return doc.body.innerHTML;
};

const activeStylesheetHrefs = (): Array<string> => {
  if (typeof document === 'undefined') return [];

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

const buildResizeScript = (token: string): string => `(function () {
  var token = ${jsStringLiteral(token)};
  function measure() {
    var root = document.documentElement;
    var body = document.body;
    var height = Math.max(
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0,
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
  schedule();
})();`;

export const isValidResizeMessage = (
  data: unknown,
  expectedToken: string
): data is ArticleFrameResizeMessage => {
  if (typeof expectedToken !== 'string' || expectedToken.length === 0)
    return false;
  if (data === null || typeof data !== 'object') return false;

  const record = data as Record<string, unknown>;
  if (record.type !== 'article-frame-resize') return false;
  if (record.token !== expectedToken) return false;
  if (typeof record.height !== 'number') return false;
  if (!Number.isFinite(record.height)) return false;

  return record.height >= 1 && record.height <= 1_000_000;
};

export const buildArticleSrcdoc = (options: ArticleSrcdocOptions): string => {
  const appOrigin = options.appOrigin ? ` ${options.appOrigin}` : '';
  const csp =
    `default-src 'none'; img-src https: http:; style-src 'unsafe-inline'${appOrigin}; ` +
    `script-src 'nonce-${options.nonce}'; base-uri 'none'; form-action 'none'`;

  const stylesheets = (options.stylesheetHrefs ?? [])
    .map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`)
    .join('');

  const nonce = escapeAttribute(options.nonce);

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    stylesheets,
    `<style>${READER_STYLES}</style>`,
    '</head>',
    `<body>${stripSourceClasses(options.html)}`,
    `<script nonce="${nonce}">${buildResizeScript(options.token)}</script>`,
    '</body>',
    '</html>',
  ].join('');
};

/**
 * `RD-FRAME-1`: sanitized article HTML in an isolated `srcdoc` iframe without
 * `allow-same-origin`, linked to the app stylesheet, guarded by CSP, and
 * resized through a per-render random `postMessage` token.
 */
export function ArticleFrame(props: ArticleFrameProps): JSX.Element {
  let iframeRef: HTMLIFrameElement | undefined;
  const [height, setHeight] = createSignal<number | undefined>(undefined);

  const frame = createMemo(() => {
    const nonce = randomToken();
    const token = randomToken();

    return {
      token,
      nonce,
      srcdoc: buildArticleSrcdoc({
        html: props.html,
        nonce,
        token,
        appOrigin: currentOrigin(),
        stylesheetHrefs: activeStylesheetHrefs(),
      }),
    };
  });

  const style = () =>
    height() === undefined ? undefined : `height: ${height()}px`;

  onSettled(() => {
    const onMessage = (event: MessageEvent) => {
      const iframe = iframeRef;
      if (!iframe || event.source !== iframe.contentWindow) return;
      if (!isValidResizeMessage(event.data, frame().token)) return;

      setHeight(Math.ceil(event.data.height));
    };

    window.addEventListener('message', onMessage);

    return () => window.removeEventListener('message', onMessage);
  });

  return (
    <iframe
      ref={(element) => {
        iframeRef = element;
      }}
      title={props.title ?? ''}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
      srcdoc={frame().srcdoc}
      style={style()}
      class="w-full min-h-[200px] border-0 bg-base-100"
    />
  );
}
