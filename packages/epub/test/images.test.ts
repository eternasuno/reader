import { expect, it } from '@effect/vitest';
import type { EbookChapter } from '@reader/business';
import { Effect } from 'effect';
import { buildOf, entryText, unzip, withXml } from './support/archive';
import { bookOf, chapterOf, contentOf } from './support/book';
import {
  goodImage,
  imageAnswers,
  missingImage,
  networkStub,
  unsupportedImage,
} from './support/network';

const buildChapters = (chapters: ReadonlyArray<EbookChapter>) =>
  Effect.gen(function* () {
    const network = networkStub(imageAnswers());
    const files = unzip(yield* buildOf(bookOf(chapters), network));

    return { files, network };
  });

const imagesOf = (document: Document): ReadonlyArray<Element> =>
  Array.from(document.getElementsByTagName('img'));

it.effect(
  'KD-BOOK-4 embeds a fetchable image, rewrites its src and drops a failed or unsupported one',
  () =>
    Effect.gen(function* () {
      const { files } = yield* buildChapters([
        chapterOf({
          content: contentOf(
            `<p><img src="${goodImage}" srcset="x 2x" sizes="100px" loading="lazy" /></p>` +
              `<p><img src="${missingImage}" /></p>` +
              `<p><img src="${unsupportedImage}" /></p>` +
              `<p><picture><source srcset="${goodImage}" /><img src="${goodImage}" /></picture></p>`
          ),
        }),
      ]);
      const source = entryText(files, 'OEBPS/chapter-1.xhtml');

      expect(source).not.toContain(goodImage);
      expect(source).not.toContain(missingImage);
      expect(source).not.toContain(unsupportedImage);

      withXml(source, (document) => {
        const images = imagesOf(document);

        expect(images).toHaveLength(2);

        for (const image of images) {
          expect(image.getAttribute('src')).toBe('images/img-1.png');
          expect(image.getAttribute('srcset')).toBeNull();
          expect(image.getAttribute('sizes')).toBeNull();
          expect(image.getAttribute('loading')).toBeNull();
        }

        expect(document.getElementsByTagName('source')).toHaveLength(0);
      });
    })
);

it.effect(
  'KD-BOOK-4 downloads an image shared by two chapters once and reuses it',
  () =>
    Effect.gen(function* () {
      const content = contentOf(`<p><img src="${goodImage}" /></p>`);
      const { files, network } = yield* buildChapters([
        chapterOf({ content }),
        chapterOf({ content }),
      ]);
      const imagePaths = Object.keys(files).filter((path) =>
        path.startsWith('OEBPS/images/')
      );

      expect(imagePaths).toEqual(['OEBPS/images/img-1.png']);
      expect(
        network.requests.filter((request) => request === goodImage)
      ).toHaveLength(1);

      for (const chapter of ['chapter-1.xhtml', 'chapter-2.xhtml']) {
        withXml(entryText(files, `OEBPS/${chapter}`), (document) => {
          expect(imagesOf(document)[0]?.getAttribute('src')).toBe(
            'images/img-1.png'
          );
        });
      }
    })
);

it.effect('KD-BOOK-4 keeps the book when every image fails', () =>
  Effect.gen(function* () {
    const { files } = yield* buildChapters([
      chapterOf({
        content: contentOf(
          `<p><img src="${missingImage}" /></p>` +
            `<p><img src="${unsupportedImage}" /></p>` +
            '<p><img /></p>'
        ),
      }),
    ]);

    expect(Object.keys(files)).toContain('OEBPS/chapter-1.xhtml');

    withXml(entryText(files, 'OEBPS/chapter-1.xhtml'), (document) => {
      expect(imagesOf(document)).toHaveLength(0);
    });
  })
);

it.effect('KD-BOOK-4 recognizes JPEG and GIF by their magic bytes', () =>
  Effect.gen(function* () {
    const jpeg = 'https://example.com/photo.jpg';
    const gif = 'https://example.com/anim.gif';
    const network = networkStub(
      new Map([
        [
          jpeg,
          () =>
            new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
              status: 200,
            }),
        ],
        [
          gif,
          () =>
            new Response(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), {
              status: 200,
            }),
        ],
      ])
    );
    const files = unzip(
      yield* buildOf(
        bookOf([
          chapterOf({
            content: contentOf(
              `<p><img src="${jpeg}" /></p><p><img src="${gif}" /></p>`
            ),
          }),
        ]),
        network
      )
    );
    const manifest = entryText(files, 'OEBPS/content.opf');

    expect(Object.keys(files)).toContain('OEBPS/images/img-1.jpg');
    expect(Object.keys(files)).toContain('OEBPS/images/img-2.gif');
    expect(manifest).toContain(
      'href="images/img-1.jpg" media-type="image/jpeg"'
    );
    expect(manifest).toContain(
      'href="images/img-2.gif" media-type="image/gif"'
    );
  })
);

it.effect(
  'KD-SPLIT-3 a text-only book downloads nothing and keeps no image',
  () =>
    Effect.gen(function* () {
      const network = networkStub(imageAnswers());
      const book = bookOf(
        [
          chapterOf({
            content: contentOf(`<p>文字<img src="${goodImage}" /></p>`),
          }),
        ],
        '留白 2024-01-02',
        false
      );
      const files = unzip(yield* buildOf(book, network));

      expect(network.requests).toEqual([]);
      expect(Object.keys(files).some((path) => path.includes('images/'))).toBe(
        false
      );
      withXml(entryText(files, 'OEBPS/chapter-1.xhtml'), (document) => {
        expect(imagesOf(document)).toEqual([]);
        expect(document.body.textContent).toContain('文字');
      });
    })
);
