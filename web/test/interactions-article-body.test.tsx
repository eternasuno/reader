import { createSignal, flush } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { ArticleBody } from '../src/components';
import { mount, setupInteractions } from './support/list-helpers';

setupInteractions();

const PHOTO = 'https://example.com/photo.jpg';

const mountBody = (html: string): HTMLElement =>
  mount(() => <ArticleBody html={html} />);

const imageOf = (container: ParentNode, selector = 'img'): HTMLImageElement =>
  container.querySelector(selector) as HTMLImageElement;

const lightbox = (): Element | null =>
  document.querySelector('[role="dialog"][aria-label="图片预览"]');

const pressKey = (target: Element, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  flush();
  return event;
};

const pressEscape = (): void => {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  flush();
};

const clickAndReport = (target: Element): { prevented: boolean } => {
  const report = { prevented: true };
  // Runs after ArticleBody's delegated handler (bubble phase) and then stops
  // jsdom from attempting a real navigation.
  const observe = (event: Event) => {
    report.prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', observe);
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })
  );
  document.removeEventListener('click', observe);
  flush();
  return report;
};

describe('ArticleBody lightbox opening', () => {
  it('opens ImageLightbox on image click and closes on Escape', () => {
    const body = mountBody(
      `<p>Intro</p><img src="${PHOTO}" alt="Sample photo">`
    );
    expect(lightbox()).toBeNull();

    imageOf(body).click();
    flush();

    const dialog = lightbox();
    expect(dialog?.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
    expect(dialog?.querySelector('img')?.getAttribute('alt')).toBe(
      'Sample photo'
    );
    expect(dialog?.textContent).toContain('Sample photo');

    pressEscape();
    expect(lightbox()).toBeNull();
  });

  it('opens ImageLightbox for images nested in other markup', () => {
    const body = mountBody(
      `<figure><div><img src="${PHOTO}" alt="Nested"></div></figure>`
    );

    imageOf(body).click();
    flush();

    expect(lightbox()?.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
  });

  it.each([['Enter'], [' ']])(
    'opens ImageLightbox when %j is pressed on an image',
    (key) => {
      const body = mountBody(`<img src="${PHOTO}" alt="Sample">`);

      const event = pressKey(imageOf(body), key);

      expect(lightbox()?.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
      expect(event.defaultPrevented).toBe(true);
    }
  );
});

describe('ArticleBody lightbox ignored targets', () => {
  it('ignores other keys on images and clicks on non-image content', () => {
    const body = mountBody(`<p>Text</p><img src="${PHOTO}" alt="Sample">`);

    for (const key of ['a', 'Tab', 'Escape', 'ArrowDown'])
      pressKey(imageOf(body), key);
    expect(lightbox()).toBeNull();

    pressKey(body.querySelector('p') as HTMLElement, 'Enter');
    (body.querySelector('p') as HTMLElement).click();
    flush();
    expect(lightbox()).toBeNull();
  });

  it('does not open ImageLightbox for images inside links', () => {
    const body = mountBody(
      `<a href="https://example.com/post"><img src="${PHOTO}" alt="Linked"></a>`
    );
    const image = imageOf(body);

    const click = clickAndReport(image);
    pressKey(image, 'Enter');

    expect(lightbox()).toBeNull();
    expect(click.prevented).toBe(false);
  });

  it('does not open ImageLightbox for images that are not http(s)', () => {
    const body = mountBody('<img src="data:image/png;base64,AA" alt="Inline">');

    imageOf(body).click();
    pressKey(imageOf(body), 'Enter');
    flush();

    expect(lightbox()).toBeNull();
  });
});

describe('ArticleBody lightbox closing', () => {
  it('closes ImageLightbox on backdrop click', () => {
    const body = mountBody(`<img src="${PHOTO}" alt="Sample">`);
    imageOf(body).click();
    flush();
    expect(lightbox()).not.toBeNull();

    lightbox()?.querySelector<HTMLElement>('[aria-hidden="true"]')?.click();
    flush();

    expect(lightbox()).toBeNull();
  });

  it('closes ImageLightbox when article html changes and keeps opening images', () => {
    const [html, setHtml] = createSignal(
      '<img src="https://example.com/first.jpg" alt="First">'
    );
    const body = mount(() => <ArticleBody html={html()} />);
    imageOf(body).click();
    flush();
    expect(lightbox()?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/first.jpg'
    );

    setHtml('<img src="https://example.com/second.jpg" alt="Second">');
    flush();
    expect(lightbox()).toBeNull();

    imageOf(body).click();
    flush();
    expect(lightbox()?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/second.jpg'
    );
  });
});
