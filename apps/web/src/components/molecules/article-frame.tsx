import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { articleFrameHeight } from '../../lib/article-frame';

const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

export const ArticleFrame = (props: { html: string }) => {
  let frame!: HTMLIFrameElement;
  const [height, setHeight] = createSignal<number>();
  const document = createMemo(() => {
    const nonce = randomSecret();
    const token = randomSecret();
    const html = props.html;
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
      document.fonts.ready.then(schedule);
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
      srcdoc: `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:dark;background:#121212}body{display:flow-root;height:auto;min-height:0;max-width:760px;margin:0 auto;padding:0;font:18px/1.9 system-ui,sans-serif;color:#d4d4d8;overflow-wrap:anywhere;box-sizing:border-box}img,video{max-width:100%!important;height:auto!important}img{object-fit:contain}figure{margin-inline:0}svg{max-width:100%}a{color:inherit}pre{overflow:auto;background:#242424;padding:1em;white-space:pre-wrap}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #3a3a3a;padding:.4em}blockquote{border-left:3px solid #3a3a3a;margin-left:0;padding-left:1em}@media(max-width:640px){body{font-size:17px}}</style><script nonce="${nonce}">${reporter}</script></head><body>${html}</body></html>`,
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

  return (
    <iframe
      ref={frame}
      title="文章正文"
      class="article-reader-frame w-full bg-[#121212]"
      style={{ height: height() === undefined ? '65vh' : `${height()}px` }}
      scrolling={height() === undefined ? 'auto' : 'no'}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
      srcdoc={document().srcdoc}
    />
  );
};
