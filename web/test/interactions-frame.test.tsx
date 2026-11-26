import { createSignal, flush } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { ArticleFrame } from '../src/components';
import { mount, setupInteractions } from './support/list-helpers';

setupInteractions();

const frameToken = (iframe: HTMLIFrameElement): string =>
  /var token = "([^"]+)"/.exec(iframe.getAttribute('srcdoc') ?? '')?.[1] ?? '';

const sendFrameMessage = (iframe: HTMLIFrameElement, data: unknown): void => {
  window.dispatchEvent(
    new MessageEvent('message', { data, source: iframe.contentWindow })
  );
  flush();
};

const mountFrame = () => {
  const container = mount(() => <ArticleFrame html="<p>Post</p>" />);
  const iframe = container.querySelector('iframe') as HTMLIFrameElement;
  return { iframe, token: frameToken(iframe) };
};

const openLightbox = () => {
  const frame = mountFrame();
  sendFrameMessage(frame.iframe, {
    type: 'article-frame-image',
    token: frame.token,
    src: 'https://example.com/photo.jpg',
    alt: 'Sample photo',
  });
  return frame;
};

const lightbox = (): Element | null =>
  document.querySelector('[role="dialog"][aria-label="图片预览"]');

describe('ArticleFrame lightbox', () => {
  it('opens ImageLightbox on valid image message and closes on Escape', () => {
    openLightbox();
    expect(lightbox()?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/photo.jpg'
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flush();
    expect(lightbox()).toBeNull();
  });

  it('closes ImageLightbox on backdrop click and when article html changes', () => {
    const [html, setHtml] = createSignal('<p>First</p>');
    const container = mount(() => <ArticleFrame html={html()} />);
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    sendFrameMessage(iframe, {
      type: 'article-frame-image',
      token: frameToken(iframe),
      src: 'https://example.com/first.jpg',
    });
    expect(lightbox()).not.toBeNull();

    const backdrop = lightbox()?.querySelector<HTMLElement>(
      '[aria-hidden="true"]'
    );
    backdrop?.click();
    flush();
    expect(lightbox()).toBeNull();

    sendFrameMessage(iframe, {
      type: 'article-frame-image',
      token: frameToken(iframe),
      src: 'https://example.com/second.jpg',
    });
    expect(lightbox()).not.toBeNull();

    setHtml('<p>Second</p>');
    flush();
    expect(lightbox()).toBeNull();
  });
});
