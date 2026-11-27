import type { JSX } from '@solidjs/web';
import { createEffect, createMemo, createSignal } from 'solid-js';
import { t } from '../i18n';
import { type ReaderAppearance, readerAppearance } from '../state';
import './articleBody.css';
import { FONT_FAMILIES, FONT_SIZES, LINE_HEIGHTS } from './articleTypography';
import { ImageLightbox } from './ImageLightbox';

interface LightboxState {
  src: string;
  alt?: string;
}

/** Source attributes that could match app styles or ids, or clobber DOM globals. */
const STRIPPED_ATTRIBUTES = ['class', 'id', 'name', 'style'];

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const makeImageKeyboardOperable = (
  img: HTMLImageElement,
  imageLabel: string
): void => {
  img.setAttribute('tabindex', '0');
  img.setAttribute('role', 'button');
  if (!img.getAttribute('alt')?.trim() && !img.hasAttribute('aria-label')) {
    img.setAttribute('aria-label', imageLabel);
  }
};

/**
 * `RD-BODY-1`: strips risky source attributes from the already sanitized
 * article HTML in an inert document and makes unlinked `http(s)` images
 * keyboard-operable for the lightbox.
 */
export const prepareArticleHtml = (
  html: string,
  imageLabel: string
): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const element of doc.body.querySelectorAll('*')) {
    for (const name of STRIPPED_ATTRIBUTES) element.removeAttribute(name);
  }

  for (const img of doc.body.querySelectorAll('img')) {
    img.setAttribute('referrerpolicy', 'no-referrer');
    if (!img.closest('a[href]') && isHttpUrl(img.getAttribute('src') ?? '')) {
      makeImageKeyboardOperable(img, imageLabel);
    }
  }

  return doc.body.innerHTML;
};

const previewableImage = (target: EventTarget | null): LightboxState | null => {
  const img = target instanceof Element ? target.closest('img') : null;
  if (!img || img.closest('a[href]')) return null;

  const src = img.currentSrc || img.src;

  return isHttpUrl(src) ? { src, alt: img.getAttribute('alt') ?? '' } : null;
};

const typographyVariables = (appearance: ReaderAppearance) => ({
  '--article-font-size': FONT_SIZES[appearance.fontSize],
  '--article-font-family': FONT_FAMILIES[appearance.fontFamily],
  '--article-line-height': LINE_HEIGHTS[appearance.lineHeight],
});

/**
 * `RD-BODY-1`: sanitized article HTML rendered directly into the page, risky
 * attributes stripped by `prepareArticleHtml`, protected by the page CSP.
 */
export function ArticleBody(props: { html: string }): JSX.Element {
  const [lightbox, setLightbox] = createSignal<LightboxState | null>(null);
  const html = createMemo(() =>
    prepareArticleHtml(props.html, t('reader.imagePreview'))
  );

  createEffect(
    () => props.html,
    () => {
      setLightbox(null);
    }
  );

  const openImagePreview = (event: Event): void => {
    const image = previewableImage(event.target);
    if (!image) return;

    event.preventDefault();
    setLightbox(image);
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated handlers for the images inside, which carry role="button" and tabindex="0". */}
      <div
        class="article-body"
        style={typographyVariables(readerAppearance())}
        innerHTML={html()}
        onClick={openImagePreview}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            openImagePreview(event);
          }
        }}
      />
      <ImageLightbox
        src={lightbox()?.src ?? null}
        alt={lightbox()?.alt}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}
