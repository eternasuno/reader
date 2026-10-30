import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import stylesheetUrl from '../../index.css?url';
import { articleFrameHeight, webpageFrameUrl } from '../../lib/article-frame';

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

const scopeContent = (html: string) => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const element of parsed.body.querySelectorAll('*')) {
    const classes = contentClasses[element.localName];
    if (classes === undefined) {
      element.removeAttribute('class');
    } else {
      element.setAttribute('class', classes);
    }
  }

  return parsed.body.innerHTML;
};

const articleBodyClass =
  'flow-root mx-auto max-w-3xl bg-[#121212] text-[#d4d4d8] font-[system-ui,sans-serif] text-lg leading-[1.9] wrap-anywhere max-sm:text-base';

export const WebpageFrame = (props: { url: string }) => (
  <div class="flex min-h-0 flex-1 flex-col">
    <p class="shrink-0 border-b border-base-200 px-4 py-2 text-xs leading-relaxed text-base-content/60">
      部分网站不允许内嵌或需要登录；若显示异常，请
      <a
        class="link mx-1"
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        打开原文
      </a>
      。
    </p>
    <Show
      when={webpageFrameUrl(props.url, window.location.origin)}
      fallback={
        <p class="p-6 text-sm text-base-content/60">
          此地址不支持安全内嵌，请使用上方链接打开原文。
        </p>
      }
    >
      {(url) => (
        <iframe
          title="内嵌原网页"
          class="block min-h-0 w-full flex-1 border-0 bg-white"
          src={url()}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerpolicy="no-referrer"
          allow="fullscreen"
          allowfullscreen
        />
      )}
    </Show>
  </div>
);

export const ArticleFrame = (props: { html: string }) => {
  let frame!: HTMLIFrameElement;
  const [height, setHeight] = createSignal<number>();
  const document = createMemo(() => {
    const nonce = randomSecret();
    const token = randomSecret();
    const html = scopeContent(props.html);
    const stylesheetHref = new URL(stylesheetUrl, window.location.href).href;
    const href = import.meta.env.DEV
      ? `${stylesheetHref}${stylesheetHref.includes('?') ? '&' : '?'}direct`
      : stylesheetHref;
    const reporter = `addEventListener('DOMContentLoaded', () => {
      const body = document.body;
      let pending = 0;
      let previous = 0;
      const report = () => {
        pending = 0;
        const height = Math.max(1, Math.ceil(body.getBoundingClientRect().height));
        if (height === previous) return;
        previous = height;
        parent.postMessage({type:'article-frame-resize',token:'${token}',height}, '*');
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

    return {
      token,
      srcdoc: `<!doctype html><html class="scheme-dark bg-[#121212]!"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src ${styleSource()}; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${escapeAttribute(href)}"><script nonce="${nonce}">${reporter}</script></head><body class="${articleBodyClass}">${html}</body></html>`,
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

    return `${measured / Number.parseFloat(getComputedStyle(window.document.documentElement).fontSize)}rem`;
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
