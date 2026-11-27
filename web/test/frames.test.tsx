import { createSignal, flush } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { ArticleBody, prepareArticleHtml } from '../src/components/ArticleBody';
import { FONT_FAMILIES } from '../src/components/articleTypography';
import { EmbeddedWebpageFrame } from '../src/components/EmbeddedWebpageFrame';
import { mount, setupInteractions } from './support/list-helpers';

setupInteractions();

const iframeOf = (container: HTMLElement): HTMLIFrameElement =>
  container.querySelector('iframe') as HTMLIFrameElement;

const IMAGE_LABEL = '图片预览';

const parsed = (html: string): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

const prepared = (html: string, label = IMAGE_LABEL): HTMLElement =>
  parsed(prepareArticleHtml(html, label));

const bodyOf = (container: HTMLElement): HTMLElement =>
  container.querySelector('.article-body') as HTMLElement;

describe('prepareArticleHtml attribute stripping', () => {
  it('strips class, id, name, and style from block and nested markup', () => {
    const root = prepared(
      '<div class="prose wide" id="keep" style="color:red">Hello</div>' +
        '<p class="a" name="n"><span class="b" id="s" style="x:y">hi</span></p>' +
        '<a class="l" id="top" name="top" href="https://example.com/x" title="T">link</a>' +
        '<img class="shot" id="i" name="img" style="width:9px" src="a.png" alt="a">'
    );

    expect(root.querySelectorAll('[class],[id],[name],[style]')).toHaveLength(
      0
    );
    expect(root.querySelector('div')?.outerHTML).toBe('<div>Hello</div>');
    expect(root.querySelector('p')?.outerHTML).toBe('<p><span>hi</span></p>');
  });

  it('keeps meaningful attributes such as href, title, src, and alt', () => {
    const root = prepared(
      '<a class="l" href="https://example.com/x" title="T">link</a><img class="shot" src="a.png" alt="a">'
    );
    const link = root.querySelector('a');
    const image = root.querySelector('img');

    expect(link?.getAttribute('href')).toBe('https://example.com/x');
    expect(link?.getAttribute('title')).toBe('T');
    expect(link?.textContent).toBe('link');
    expect(image?.getAttribute('src')).toBe('a.png');
    expect(image?.getAttribute('alt')).toBe('a');
  });

  it('adds referrerpolicy="no-referrer" to every image', () => {
    const root = prepared(
      '<img src="https://example.com/a.png">' +
        '<a href="https://example.com"><img src="https://example.com/b.png"></a>' +
        '<img src="data:image/png;base64,AA"><img src="a.png">'
    );
    const images = root.querySelectorAll('img');

    expect(images).toHaveLength(4);
    for (const image of images) {
      expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    }
  });
});

describe('prepareArticleHtml image keyboard operability', () => {
  it('makes unlinked http(s) images focusable buttons', () => {
    const root = prepared(
      '<img src="https://example.com/a.png" alt="A"><img src="HTTP://example.com/b.png" alt="B">'
    );

    expect(root.querySelectorAll('img')).toHaveLength(2);
    for (const image of root.querySelectorAll('img')) {
      expect(image.getAttribute('tabindex')).toBe('0');
      expect(image.getAttribute('role')).toBe('button');
    }
  });

  it('labels only images without alt text, using the given label', () => {
    const root = prepared(
      '<img src="https://example.com/none.png">' +
        '<img src="https://example.com/empty.png" alt="">' +
        '<img src="https://example.com/blank.png" alt="   ">' +
        '<img src="https://example.com/alt.png" alt="Described">' +
        '<img src="https://example.com/own.png" aria-label="Own">',
      'Image preview'
    );
    const label = (name: string) =>
      root.querySelector(`img[src$="${name}"]`)?.getAttribute('aria-label') ??
      null;

    expect(label('none.png')).toBe('Image preview');
    expect(label('empty.png')).toBe('Image preview');
    expect(label('blank.png')).toBe('Image preview');
    expect(label('alt.png')).toBeNull();
    expect(label('own.png')).toBe('Own');
  });

  it('leaves linked and non-http(s) images out of the keyboard flow', () => {
    const root = prepared(
      '<a href="https://example.com/post"><img src="https://example.com/linked.png"></a>' +
        '<a href="https://example.com/post"><span><img src="https://example.com/nested.png"></span></a>' +
        '<img src="data:image/png;base64,AA">' +
        '<img src="javascript:alert(1)">'
    );

    expect(root.querySelectorAll('img')).toHaveLength(4);
    for (const image of root.querySelectorAll('img')) {
      expect(image.hasAttribute('tabindex')).toBe(false);
      expect(image.hasAttribute('role')).toBe(false);
      expect(image.hasAttribute('aria-label')).toBe(false);
    }
  });

  it('treats an anchor without href as no link', () => {
    const root = prepared('<a><img src="https://example.com/a.png"></a>');

    expect(root.querySelector('img')?.getAttribute('role')).toBe('button');
  });
});

describe('ArticleBody', () => {
  it('renders sanitized html inline instead of in an iframe', () => {
    const container = mount(() => (
      <ArticleBody html='<p class="lead" id="x">Body</p>' />
    ));
    const paragraph = bodyOf(container).querySelector('p');

    expect(container.querySelector('iframe')).toBeNull();
    expect(paragraph?.textContent).toBe('Body');
    expect(paragraph?.hasAttribute('class')).toBe(false);
    expect(paragraph?.hasAttribute('id')).toBe(false);
  });

  it('applies the default typography as CSS variables', () => {
    const style = bodyOf(mount(() => <ArticleBody html="<p>Body</p>" />)).style;

    expect(style.getPropertyValue('--article-font-size')).toBe('1rem');
    expect(style.getPropertyValue('--article-font-family')).toBe(
      FONT_FAMILIES.sans
    );
    expect(style.getPropertyValue('--article-line-height')).toBe('1.8');
  });

  it('re-renders the body when html changes', () => {
    const [html, setHtml] = createSignal('<p class="a">One</p>');
    const body = bodyOf(mount(() => <ArticleBody html={html()} />));
    expect(body.textContent).toBe('One');

    setHtml('<h2 class="b">Two</h2>');
    flush();

    expect(body.textContent).toBe('Two');
    expect(body.querySelector('p')).toBeNull();
    expect(body.querySelector('h2')?.hasAttribute('class')).toBe(false);
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
