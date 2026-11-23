import type { JSX } from '@solidjs/web';
import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArticleFrame,
  buildArticleSrcdoc,
  isValidResizeMessage,
  stripSourceClasses,
} from '../src/components/ArticleFrame';
import {
  EmbeddedWebpageFrame,
  isSafeEmbedUrl,
} from '../src/components/EmbeddedWebpageFrame';
import { setLocale } from '../src/i18n';

let disposers: Array<() => void> = [];

const mount = (component: () => JSX.Element): HTMLElement => {
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(render(component, container));
  flush();

  return container;
};

const iframeOf = (container: HTMLElement): HTMLIFrameElement =>
  container.querySelector('iframe') as HTMLIFrameElement;

const srcdocOf = (iframe: HTMLIFrameElement): string =>
  iframe.getAttribute('srcdoc') ?? '';
const nonceOf = (srcdoc: string): string =>
  /script-src 'nonce-([^']+)'/.exec(srcdoc)?.[1] ?? '';
const tokenOf = (srcdoc: string): string =>
  /var token = "([^"]+)"/.exec(srcdoc)?.[1] ?? '';

const dispatchResize = (source: Window | null, data: unknown): void => {
  window.dispatchEvent(new MessageEvent('message', { data, source }));
  flush();
};

beforeEach(() => {
  localStorage.clear();
  setLocale('zh-CN');
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const SRCDOC = buildArticleSrcdoc({
  html: '<p class="lead">Hello</p><img class="shot" src="a.png" alt="a">',
  nonce: 'nonce123',
  token: 'token456',
  appOrigin: 'https://app.example',
  stylesheetHrefs: ['https://app.example/assets/app.css'],
});
const RESIZE_MESSAGE = { type: 'article-frame-resize' };
const BLOCK_SELECTORS =
  'p {|h1 {|h2 {|h3 {|h4,|h5,|h6 {|a {|pre {|code {|blockquote {|img {|table {'.split(
    '|'
  );

describe('stripSourceClasses', () => {
  it('removes source classes for block and nested markup', () => {
    const html = '<div class="prose wide" id="keep" style="color:red">x</div>';

    expect(stripSourceClasses(html)).toBe(
      '<div id="keep" style="color:red">x</div>'
    );
    expect(
      stripSourceClasses('<p class="a"><span class="b">hi</span></p>')
    ).toBe('<p><span>hi</span></p>');
  });
});

describe('buildArticleSrcdoc sanitization', () => {
  it('strips stored source classes from the injected body', () => {
    expect(SRCDOC).not.toContain('class="lead"');
    expect(SRCDOC).not.toContain('class="shot"');
    expect(SRCDOC).toContain('Hello');
    expect(SRCDOC).toContain('<img src="a.png" alt="a">');
  });

  it('omits stylesheets when absent, escapes hrefs, and omits script bridge without tokens', () => {
    const bare = buildArticleSrcdoc({
      html: '<p>x</p>',
      nonce: 'n',
      token: 't',
      appOrigin: '',
    });
    const noScript = buildArticleSrcdoc({
      html: '<p class="lead">Static</p>',
      appOrigin: '',
    });
    const escaped = buildArticleSrcdoc({
      html: '',
      nonce: 'n',
      token: 't',
      appOrigin: 'https://app.example',
      stylesheetHrefs: ['https://cdn.example/a.css?x="1"&y=<2>'],
    });

    expect(bare).not.toContain('<link rel="stylesheet"');
    expect(bare).toContain("style-src 'unsafe-inline'; script-src 'nonce-n'");
    expect(noScript).toContain("script-src 'none'");
    expect(noScript).not.toContain('<script');
    expect(noScript).toContain('<p>Static</p>');
    expect(escaped).toContain(
      'href="https://cdn.example/a.css?x=&quot;1&quot;&amp;y=&lt;2&gt;"'
    );
  });
});

describe('buildArticleSrcdoc policy', () => {
  it('renders the CSP meta tag with the nonce and app origin', () => {
    expect(SRCDOC).toContain('http-equiv="Content-Security-Policy"');
    expect(SRCDOC).toContain(
      "default-src 'none'; img-src https: http:; style-src 'unsafe-inline' https://app.example; script-src 'nonce-nonce123'; base-uri 'none'; form-action 'none'"
    );
  });

  it('applies the fixed reader typography and app stylesheet', () => {
    for (const selector of BLOCK_SELECTORS) {
      expect(SRCDOC).toContain(selector);
    }
    expect(SRCDOC).toContain(
      '<link rel="stylesheet" href="https://app.example/assets/app.css">'
    );
    expect(SRCDOC).toContain('font-family: -apple-system');
    expect(SRCDOC).toContain('"PingFang SC"');
    expect(SRCDOC).toMatch(/Arial[^;]*"Noto Sans CJK SC"/);
    expect(SRCDOC).not.toMatch(/font-family:\s*system-ui/);
    expect(SRCDOC).toContain('#1e1e1e');
    expect(SRCDOC).toContain('max-width: 100%');
  });

  it('embeds the nonce-guarded resize script with the token', () => {
    expect(SRCDOC).toContain('<script nonce="nonce123">');
    expect(SRCDOC).toContain('var token = "token456"');
    expect(SRCDOC).toContain("type: 'article-frame-resize'");
    expect(SRCDOC).toContain('window.parent.postMessage(');
    expect(SRCDOC).toContain(", '*')");
    expect(SRCDOC).toContain('ResizeObserver');
  });
});

describe('isValidResizeMessage', () => {
  const token = 'token456';
  const resize = (overrides: Record<string, unknown>): unknown => ({
    ...RESIZE_MESSAGE,
    token,
    height: 10,
    ...overrides,
  });

  it('accepts well-formed resize messages within bounds', () => {
    for (const height of [1, 1_000_000, 321.4]) {
      expect(isValidResizeMessage(resize({ height }), token)).toBe(true);
    }
  });

  it('rejects foreign tokens, wrong types, and out-of-range heights', () => {
    for (const data of [null, undefined, 'article-frame-resize', 42, [], {}])
      expect(isValidResizeMessage(data, token)).toBe(false);
    for (const height of [0, -5, 1_000_001, '100', Infinity, null])
      expect(isValidResizeMessage(resize({ height }), token)).toBe(false);
    for (const bad of [
      { type: 'other' },
      { token: 'other' },
      { token: undefined },
    ])
      expect(isValidResizeMessage(resize(bad), token)).toBe(false);
    expect(isValidResizeMessage(resize({}), '')).toBe(false);
  });
});

describe('ArticleFrame sandbox', () => {
  it('renders an isolated sandboxed iframe without allow-same-origin', () => {
    const iframe = iframeOf(
      mount(() => <ArticleFrame html='<p class="lead">Body</p>' title="文章" />)
    );
    const sandbox = iframe.getAttribute('sandbox') ?? '';

    expect(sandbox.split(' ')).toEqual([
      'allow-scripts',
      'allow-popups',
      'allow-popups-to-escape-sandbox',
    ]);
    expect(iframe.getAttribute('title')).toBe('文章');
    expect(srcdocOf(iframe)).not.toContain('class="lead"');
  });

  it('links the active app stylesheet into the srcdoc', () => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/assets/app.css';
    document.head.append(stylesheet);
    const doc = srcdocOf(
      iframeOf(mount(() => <ArticleFrame html="<p>Body</p>" />))
    );
    expect(doc).toContain(
      `<link rel="stylesheet" href="${new URL('/assets/app.css', document.baseURI).href}">`
    );
    stylesheet.remove();
  });
});

describe('ArticleFrame tokens', () => {
  it('issues a fresh nonce and token per render and on html change', () => {
    const docFor = (h: string) =>
      srcdocOf(iframeOf(mount(() => <ArticleFrame html={h} />)));
    const first = docFor('<p>a</p>');
    const second = docFor('<p>a</p>');
    const [html, setHtml] = createSignal('<p>one</p>');
    const iframe = iframeOf(mount(() => <ArticleFrame html={html()} />));
    const before = srcdocOf(iframe);

    setHtml('<p>two</p>');
    flush();

    const after = srcdocOf(iframe);
    expect(nonceOf(first).length).toBeGreaterThan(7);
    expect(tokenOf(first).length).toBeGreaterThan(7);
    expect(nonceOf(second)).not.toBe(nonceOf(first));
    expect(tokenOf(second)).not.toBe(tokenOf(first));
    expect(after).toContain('two');
    expect(nonceOf(after)).not.toBe(nonceOf(before));
    expect(tokenOf(after)).not.toBe(tokenOf(before));
  });

  it('renders static content without a script bridge when Web Crypto is missing', () => {
    for (const stub of [undefined, {}]) {
      vi.stubGlobal('crypto', stub);
      const iframe = iframeOf(
        mount(() => <ArticleFrame html='<p class="lead">Static</p>' />)
      );
      const doc = srcdocOf(iframe);
      expect(doc).toContain("script-src 'none'");
      expect(doc).not.toContain('<script');
      expect(doc).toContain('<p>Static</p>');
      expect(iframe.getAttribute('sandbox')).toBe(
        'allow-popups allow-popups-to-escape-sandbox'
      );
      const bad = { ...RESIZE_MESSAGE, token: '', height: 200 };
      dispatchResize(iframe.contentWindow, bad);
      expect(iframe.style.height).toBe('');
    }
  });
});

describe('ArticleFrame resize messages', () => {
  it('applies only same-source, same-token, in-range resize messages', () => {
    const iframe = iframeOf(mount(() => <ArticleFrame html="<p>one</p>" />));
    const token = tokenOf(srcdocOf(iframe));
    const cases: Array<[number, Window | null, string, string]> = [
      [321.4, iframe.contentWindow, token, '322px'],
      [100, iframe.contentWindow, 'stale', '322px'],
      [100, window, token, '322px'],
      [2_000_000, iframe.contentWindow, token, '322px'],
      [44, iframe.contentWindow, token, '44px'],
    ];

    for (const [height, source, tok, expected] of cases) {
      dispatchResize(source, { ...RESIZE_MESSAGE, token: tok, height });
      expect(iframe.style.height).toBe(expected);
    }
  });

  it('stops listening once the frame is disposed', () => {
    const iframe = iframeOf(mount(() => <ArticleFrame html="<p>one</p>" />));
    const token = tokenOf(srcdocOf(iframe));

    disposers.pop()?.();
    const msg = { ...RESIZE_MESSAGE, token, height: 500 };
    dispatchResize(iframe.contentWindow, msg);
    expect(iframe.style.height).toBe('');
  });
});

describe('isSafeEmbedUrl', () => {
  it('accepts http(s) URLs without credentials outside the app origin', () => {
    const ok = isSafeEmbedUrl;
    expect(ok('https://example.com/post')).toBe(true);
    expect(ok('http://example.com/post')).toBe(true);
    expect(ok('https://example.com/post', 'https://app.example')).toBe(true);
    expect(ok('https://app.example/post', 'https://other.example')).toBe(true);
    expect(ok('https://news.example.com/post', window.location.origin)).toBe(
      true
    );
  });

  it('rejects same-origin URLs, credentials, and non-http(s) schemes', () => {
    const rejected =
      'https://app.example/post|https://APP.example/post|https://user:pass@example.com/post|https://user@example.com/post|ftp://example.com/file|javascript:alert(1)|file:///etc/passwd|not a url||   '.split(
        '|'
      );

    for (const url of rejected)
      expect(isSafeEmbedUrl(url, 'https://app.example')).toBe(false);
    expect(isSafeEmbedUrl(`${window.location.origin}/post`)).toBe(false);
  });
});

describe('EmbeddedWebpageFrame', () => {
  it('renders the notice and sandboxed iframe for safe URLs', () => {
    const iframe = iframeOf(
      mount(() => (
        <EmbeddedWebpageFrame url="https://example.com/post" title="原文" />
      ))
    );

    expect(iframe.getAttribute('src')).toBe('https://example.com/post');
    expect(iframe.getAttribute('sandbox')).toBe(
      'allow-scripts allow-forms allow-popups allow-same-origin'
    );
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe.getAttribute('title')).toBe('原文');
    expect(iframe.className).toContain('h-full w-full flex-1');
  });

  it('shows the unsafe notice instead of an iframe', () => {
    for (const url of [
      `${window.location.origin}/post`,
      'https://user:pass@example.com/post',
    ]) {
      const mounted = mount(() => <EmbeddedWebpageFrame url={url} />);
      expect(mounted.querySelector('iframe')).toBeNull();
      expect(mounted.textContent).toContain('此地址不支持安全内嵌');
      expect(mounted.textContent).not.toContain('部分网站不允许内嵌');
    }
  });
});
