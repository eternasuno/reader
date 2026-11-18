import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import stylesheetUrl from '../index.css?url';

/** The message the frame's reporter posts, with its per-mount token. */
const resizeMessage = 'article-frame-resize';

const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

const styleSource = () => {
  const { origin } = window.location;

  return origin && origin !== 'null'
    ? `'unsafe-inline' ${origin}`
    : "'unsafe-inline'";
};

/**
 * Accepts a height only from the frame's own window, for this mount's token, and
 * only a finite value in a sane range; nothing else may change the layout
 * (ui.md: Article isolation).
 */
export const articleFrameHeight = (
  event: { readonly source: unknown; readonly data: unknown },
  frameWindow: unknown,
  token: string
): number | undefined => {
  if (!frameWindow || event.source !== frameWindow) return;

  const data = event.data;

  if (
    typeof data !== 'object' ||
    data === null ||
    Reflect.get(data, 'type') !== resizeMessage ||
    Reflect.get(data, 'token') !== token
  ) {
    return;
  }

  const height: unknown = Reflect.get(data, 'height');

  if (
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height < 1 ||
    height > 1_000_000
  ) {
    return;
  }

  return Math.ceil(height);
};

/** The fixed per-element class map: the single place article typography lives. */
const contentClasses: Readonly<Record<string, string>> = {
  img: 'inline align-baseline h-auto! max-w-full! object-contain',
  video: 'inline align-baseline h-auto! max-w-full!',
  svg: 'inline max-w-full align-baseline',
  p: 'my-[1em]',
  h1: 'my-[0.67em] text-[2em] font-bold',
  h2: 'my-[0.83em] text-[1.5em] font-bold',
  h3: 'my-[1em] text-[1.17em] font-bold',
  h4: 'my-[1.33em] text-[1em] font-bold',
  h5: 'my-[1.67em] text-[0.83em] font-bold',
  h6: 'my-[2.33em] text-[0.67em] font-bold',
  ul: 'my-[1em] list-disc pl-10',
  ol: 'my-[1em] list-decimal pl-10',
  dl: 'my-[1em]',
  dd: 'ml-10',
  figure: 'mx-0 my-[1em]',
  a: 'text-inherit underline',
  pre: 'my-[1em] overflow-auto whitespace-pre-wrap bg-[#242424] p-[1em]',
  table: 'max-w-full border-collapse',
  td: 'border border-[#3a3a3a] p-[.4em]',
  th: 'border border-[#3a3a3a] p-[.4em] text-center font-bold',
  blockquote: 'my-[1em] ml-0 mr-10 border-l-2 border-[#3a3a3a] pl-[1em]',
};

/** Strips the stored classes and reapplies the fixed map (ui.md). */
const scopeContent = (html: string) => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  for (const element of parsed.body.querySelectorAll('*')) {
    const classes = contentClasses[element.localName];

    if (classes === undefined) element.removeAttribute('class');
    else element.setAttribute('class', classes);
  }

  return parsed.body.innerHTML;
};

const articleBodyClass =
  'flow-root mx-auto max-w-3xl bg-[#121212] text-[#d4d4d8] font-sans text-lg leading-[1.9] wrap-anywhere max-sm:text-base';

/** The inline reporter: measures the body and posts its height to the parent. */
const reporterScript = (
  token: string
) => `addEventListener('DOMContentLoaded', () => {
  const body = document.body;
  let pending = 0;
  let previous = 0;
  const report = () => {
    pending = 0;
    const height = Math.max(1, Math.ceil(body.getBoundingClientRect().height));
    if (height === previous) return;
    previous = height;
    parent.postMessage({type:'${resizeMessage}',token:'${token}',height}, '*');
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(report);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(body);
  addEventListener('resize', schedule);
  addEventListener('load', schedule, true);
  const reportFontsReady = async () => {
    try {
      await document.fonts.ready;
      schedule();
    } catch {
      schedule();
    }
  };
  void reportFontsReady();
  addEventListener('pagehide', () => {
    observer.disconnect();
    cancelAnimationFrame(pending);
    removeEventListener('resize', schedule);
    removeEventListener('load', schedule, true);
  }, {once:true});
  schedule();
}, {once:true});`;

const stylesheetHref = () => {
  const href = new URL(stylesheetUrl, window.location.href).href;

  return import.meta.env.DEV ? `${href}?direct` : href;
};

export type ArticleFrameProps = {
  /** Sanitized article HTML (CM-ART-4): it never enters the app document. */
  readonly html: string;
};

/**
 * Articles are shown only here: a sandboxed iframe built from `srcdoc` with an
 * opaque origin, the app's stylesheet as its only external resource, a CSP meta
 * tag, and per-mount nonce and resize token (ui.md: Article isolation).
 */
export const ArticleFrame = (props: ArticleFrameProps) => {
  let frame!: HTMLIFrameElement;
  const [height, setHeight] = createSignal<number>();
  const document = createMemo(() => {
    const nonce = randomSecret();
    const token = randomSecret();
    const html = scopeContent(props.html);
    const href = escapeAttribute(stylesheetHref());

    return {
      token,
      srcdoc: `<!doctype html><html class="scheme-dark bg-[#121212]!"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src ${styleSource()}; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${href}"><script nonce="${nonce}">${reporterScript(token)}</script></head><body class="${articleBodyClass}">${html}</body></html>`,
    };
  });

  createEffect(() => {
    const token = document().token;

    setHeight(undefined);

    const receive = (event: MessageEvent<unknown>) => {
      const measured = articleFrameHeight(event, frame.contentWindow, token);

      if (measured !== undefined) setHeight(measured);
    };

    window.addEventListener('message', receive);
    onCleanup(() => window.removeEventListener('message', receive));
  });

  const heightStyle = () => {
    const measured = height();

    if (measured === undefined) return '65vh';

    const rootSize = getComputedStyle(window.document.documentElement).fontSize;

    return `${measured / Number.parseFloat(rootSize)}rem`;
  };

  return (
    <iframe
      ref={frame}
      title="文章正文"
      class="block h-(--article-height) w-full border-0 bg-[#121212]"
      style={`--article-height:${heightStyle()}`}
      scrolling={height() === undefined ? 'auto' : 'no'}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
      srcdoc={document().srcdoc}
    />
  );
};
