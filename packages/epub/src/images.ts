import { Effect } from 'effect';
import type { HttpClient } from 'effect/http';

/** An image embedded in the book, ready for the manifest and the archive (KD-BOOK-4). */
export type EmbeddedImage = {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
};

type ImageType = {
  readonly mediaType: string;
  readonly extension: string;
};

type DownloadedImage = ImageType & { readonly bytes: Uint8Array };

/** Magic bytes decide the type, so a wrong Content-Type cannot embed junk (KD-BOOK-4). */
const IMAGE_TYPES: ReadonlyArray<{
  readonly signature: ReadonlyArray<number>;
  readonly type: ImageType;
}> = [
  {
    signature: [0xff, 0xd8, 0xff],
    type: { mediaType: 'image/jpeg', extension: 'jpg' },
  },
  {
    signature: [0x89, 0x50, 0x4e, 0x47],
    type: { mediaType: 'image/png', extension: 'png' },
  },
  {
    signature: [0x47, 0x49, 0x46, 0x38],
    type: { mediaType: 'image/gif', extension: 'gif' },
  },
];

const matches = (
  bytes: Uint8Array,
  signature: ReadonlyArray<number>
): boolean => signature.every((byte, index) => bytes[index] === byte);

const imageTypeOf = (bytes: Uint8Array): ImageType | undefined =>
  IMAGE_TYPES.find(({ signature }) => matches(bytes, signature))?.type;

/** The absolute http(s) address of an `<img>`, or undefined for anything unusable. */
export const imageHref = (src: string): string | undefined => {
  try {
    const url = new URL(src);

    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};

/** Every distinct image address of the book, in reading order (KD-BOOK-4). */
export const imageSources = (
  documents: ReadonlyArray<Document>
): ReadonlyArray<string> => {
  const hrefs = new Set<string>();

  for (const document of documents) {
    for (const image of document.querySelectorAll('img[src]')) {
      const href = imageHref(image.getAttribute('src') ?? '');

      if (href !== undefined) {
        hrefs.add(href);
      }
    }
  }

  return Array.from(hrefs);
};

/**
 * Downloads one image and reads its type from the bytes it returned. Any
 * failure — a non-2xx answer, a transport error, another body failure — and
 * an unsupported type yield none, so the image is dropped instead of failing
 * the book (KD-BOOK-4).
 */
const download = (
  client: HttpClient.HttpClient,
  href: string
): Effect.Effect<DownloadedImage | undefined> =>
  Effect.gen(function* () {
    const response = yield* client.get(href);

    if (response.status < 200 || response.status >= 300) {
      return undefined;
    }

    const body = yield* response.arrayBuffer;
    const bytes = new Uint8Array(body);
    const type = imageTypeOf(bytes);

    return type === undefined ? undefined : { ...type, bytes };
  }).pipe(Effect.catchCause(() => Effect.undefined));

/**
 * Downloads the book's images one after another and names the usable ones
 * `images/img-N.ext`. A URL shared by several chapters is downloaded once and
 * maps to the same image (KD-BOOK-4).
 */
export const downloadImages = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  sources: ReadonlyArray<string>
) {
  const images = new Map<string, EmbeddedImage>();

  for (const href of sources) {
    const image = yield* download(client, href);

    if (image !== undefined) {
      images.set(href, {
        path: `images/img-${images.size + 1}.${image.extension}`,
        mediaType: image.mediaType,
        bytes: image.bytes,
      });
    }
  }

  return images;
});

/**
 * Rewrites every `<img>` of a chapter to its embedded file and drops the
 * ones the book does not hold; `<picture>` sources point outside the archive
 * and go as well (KD-BOOK-4).
 */
export const rewriteImages = (
  document: Document,
  images: ReadonlyMap<string, EmbeddedImage>
): void => {
  for (const image of document.querySelectorAll('img')) {
    const href = imageHref(image.getAttribute('src') ?? '');
    const embedded = href === undefined ? undefined : images.get(href);

    if (embedded === undefined) {
      image.remove();
      continue;
    }

    image.setAttribute('src', embedded.path);
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    image.removeAttribute('loading');
  }

  for (const source of document.querySelectorAll('picture > source')) {
    source.remove();
  }
};
