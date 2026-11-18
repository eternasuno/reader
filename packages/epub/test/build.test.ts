import { expect, it } from '@effect/vitest';
import type { EbookChapter } from '@reader/business';
import { Effect } from 'effect';
import {
  buildOf,
  entryBytes,
  entryText,
  unzip,
  withXml,
} from './support/archive';
import { bookOf, chapterOf, contentOf, titleOf } from './support/book';
import { goodImage, imageAnswers, networkStub } from './support/network';

const buildFiles = (chapters: ReadonlyArray<EbookChapter>) =>
  Effect.gen(function* () {
    const network = networkStub(imageAnswers());

    return { files: unzip(yield* buildOf(bookOf(chapters), network)), network };
  });

it.effect(
  'KD-BOOK-1 stores the mimetype first and names the package document in the container',
  () =>
    Effect.gen(function* () {
      const bytes = yield* buildOf(
        bookOf([chapterOf()]),
        networkStub(imageAnswers())
      );
      const files = unzip(bytes);

      expect(Object.keys(files)[0]).toBe('mimetype');
      expect(new TextDecoder().decode(entryBytes(files, 'mimetype'))).toBe(
        'application/epub+zip'
      );

      const nameLength = (bytes[26] ?? 0) + ((bytes[27] ?? 0) << 8);

      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);
      expect(bytes[2]).toBe(0x03);
      expect(bytes[3]).toBe(0x04);
      expect(bytes[8]).toBe(0);
      expect(bytes[9]).toBe(0);
      expect(new TextDecoder().decode(bytes.slice(30, 30 + nameLength))).toBe(
        'mimetype'
      );

      withXml(entryText(files, 'META-INF/container.xml'), (document) => {
        expect(
          document
            .getElementsByTagName('rootfile')[0]
            ?.getAttribute('full-path')
        ).toBe('OEBPS/content.opf');
      });
    })
);

it.effect(
  'KD-BOOK-1 writes an EPUB 3 package document with a uuid, the title and the language',
  () =>
    Effect.gen(function* () {
      const { files } = yield* buildFiles([chapterOf()]);

      withXml(entryText(files, 'OEBPS/content.opf'), (document) => {
        expect(document.documentElement.getAttribute('version')).toBe('3.0');
        expect(document.documentElement.getAttribute('unique-identifier')).toBe(
          'book-id'
        );
        expect(
          document.getElementsByTagName('dc:identifier')[0]?.textContent
        ).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
        expect(document.getElementsByTagName('dc:title')[0]?.textContent).toBe(
          '留白 2024-01-02'
        );
        expect(
          document.getElementsByTagName('dc:language')[0]?.textContent
        ).toBe('zh');

        const modified = Array.from(document.getElementsByTagName('meta')).find(
          (meta) => meta.getAttribute('property') === 'dcterms:modified'
        );

        expect(modified?.textContent).toBe('2024-01-02T03:04:05Z');
      });
    })
);

it.effect(
  'KD-BOOK-2 lists every chapter in the spine in reading order and the png in the manifest',
  () =>
    Effect.gen(function* () {
      const { files } = yield* buildFiles([
        chapterOf({ content: contentOf(`<p><img src="${goodImage}" /></p>`) }),
        chapterOf({ title: titleOf('Second') }),
        chapterOf({ title: titleOf('Third') }),
      ]);

      withXml(entryText(files, 'OEBPS/content.opf'), (document) => {
        const items = Array.from(document.getElementsByTagName('item')).map(
          (item) => ({
            href: item.getAttribute('href'),
            mediaType: item.getAttribute('media-type'),
          })
        );
        const refs = Array.from(document.getElementsByTagName('itemref')).map(
          (item) => item.getAttribute('idref')
        );

        expect(refs).toEqual(['chapter-1', 'chapter-2', 'chapter-3']);
        expect(items.map((item) => item.href)).toEqual(
          expect.arrayContaining([
            'chapter-1.xhtml',
            'chapter-2.xhtml',
            'chapter-3.xhtml',
          ])
        );
        expect(
          items.find((item) => item.href === 'images/img-1.png')?.mediaType
        ).toBe('image/png');
      });
    })
);

it.effect(
  'KD-BOOK-1 builds a navigation listing every chapter title and file',
  () =>
    Effect.gen(function* () {
      const { files } = yield* buildFiles([
        chapterOf({ title: titleOf('First <&> article') }),
        chapterOf({ title: titleOf('Second') }),
      ]);

      withXml(entryText(files, 'OEBPS/nav.xhtml'), (document) => {
        const nav = document.getElementsByTagName('nav')[0];
        const links = Array.from(document.getElementsByTagName('a'));

        expect(nav?.getAttribute('epub:type')).toBe('toc');
        expect(links.map((link) => link.getAttribute('href'))).toEqual([
          'chapter-1.xhtml',
          'chapter-2.xhtml',
        ]);
        expect(links.map((link) => link.textContent)).toEqual([
          'First <&> article',
          'Second',
        ]);
      });
    })
);

it.effect(
  'KD-BOOK-1 makes every chapter and the navigation well-formed XHTML',
  () =>
    Effect.gen(function* () {
      const { files } = yield* buildFiles([
        chapterOf({ content: contentOf('<p>One<br />Two</p>') }),
        chapterOf({ content: contentOf('<p>&nbsp;Three</p>') }),
      ]);

      for (const path of Object.keys(files)) {
        if (!path.startsWith('OEBPS/') || !path.endsWith('.xhtml')) {
          continue;
        }

        withXml(entryText(files, path), (document) => {
          expect(document.documentElement.namespaceURI).toBe(
            'http://www.w3.org/1999/xhtml'
          );
        });
      }
    })
);
