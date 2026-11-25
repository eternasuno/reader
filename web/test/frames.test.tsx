import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  ArticleFrame,
  buildArticleSrcdoc,
  isValidResizeMessage,
} from '../src/components/ArticleFrame';
import { EmbeddedWebpageFrame } from '../src/components/EmbeddedWebpageFrame';
import { mount, setupInteractions } from './support/list-helpers';

setupInteractions();

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

const SRCDOC = buildArticleSrcdoc({
  html: '<div class="prose wide" id="keep" style="color:red">Hello</div><p class="a"><span class="b">hi</span></p><img class="shot" src="a.png" alt="a">',
  nonce: 'nonce123',
  token: 'token456',
  appOrigin: 'https://app.example',
  stylesheetHrefs: ['https://app.example/assets/app.css'],
});
const RESIZE_MESSAGE = { type: 'article-frame-resize' };

describe('buildArticleSrcdoc sanitization', () => {
  it('strips stored source classes from block and nested markup', () => {
    expect(SRCDOC).not.toContain('class="prose wide"');
    expect(SRCDOC).not.toContain('class="a"');
    expect(SRCDOC).not.toContain('class="b"');
    expect(SRCDOC).not.toContain('class="shot"');
    expect(SRCDOC).toContain('<div id="keep" style="color:red">Hello</div>');
    expect(SRCDOC).toContain('<p><span>hi</span></p>');
    expect(SRCDOC).toContain('<img src="a.png" alt="a">');
  });

  it('omits stylesheets when absent and escapes hrefs', () => {
    const bare = buildArticleSrcdoc({
      html: '<p>x</p>',
      nonce: 'n',
      token: 't',
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
    const container = document.createElement('div');
    document.body.append(container);
    const dispose = render(() => <ArticleFrame html="<p>one</p>" />, container);
    flush();
    const iframe = iframeOf(container);
    const token = tokenOf(srcdocOf(iframe));

    dispose();
    const msg = { ...RESIZE_MESSAGE, token, height: 500 };
    dispatchResize(iframe.contentWindow, msg);
    expect(iframe.style.height).toBe('');
  });
});

describe('EmbeddedWebpageFrame', () => {
  it('renders the sandboxed iframe for safe URLs', () => {
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
  });

  it.each([
    ['same-origin URL', `${window.location.origin}/post`],
    ['URL with credentials', 'https://user:pass@example.com/post'],
  ])('shows the unsafe notice instead of an iframe for %s', (_, url) => {
    const mounted = mount(() => <EmbeddedWebpageFrame url={url} />);
    expect(mounted.querySelector('iframe')).toBeNull();
    expect(mounted.textContent).toContain('此地址不支持安全内嵌');
  });

  it('shows the unparsable notice for URLs the browser cannot parse', () => {
    const mounted = mount(() => (
      <EmbeddedWebpageFrame url="http://127.0.0.1:99999/x.html" />
    ));
    expect(mounted.querySelector('iframe')).toBeNull();
    expect(mounted.textContent).toContain(
      '此地址无法被浏览器解析，无法内嵌或打开。'
    );
    expect(mounted.textContent).not.toContain('请使用上方链接');
  });
});
