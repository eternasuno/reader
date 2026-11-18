import { expect, it } from '@effect/vitest';
import type { EbookChapter } from '@reader/business';
import { DateTime, Effect, Option } from 'effect';
import { buildOf, entryText, unzip, withXml } from './support/archive';
import {
  articleUrl,
  bookOf,
  chapterOf,
  contentOf,
  titleOf,
} from './support/book';
import { imageAnswers, networkStub } from './support/network';

const buildChapter = (chapter: EbookChapter) =>
  Effect.gen(function* () {
    const network = networkStub(imageAnswers());
    const files = unzip(yield* buildOf(bookOf([chapter]), network));

    return entryText(files, 'OEBPS/chapter-1.xhtml');
  });

const metaOf = (document: Document): Element | undefined =>
  Array.from(document.getElementsByTagName('p')).find(
    (paragraph) => paragraph.getAttribute('class') === 'meta'
  );

it.effect(
  'KD-BOOK-3 prints the title heading, the source, the publish date, the address and the text',
  () =>
    Effect.gen(function* () {
      const source = yield* buildChapter(
        chapterOf({
          title: titleOf('An <&> article'),
          source: 'Go <Blog>',
          publishedAt: Option.some(DateTime.makeUnsafe('2024-05-06T12:00:00Z')),
          content: contentOf('<p>Body <strong>text</strong></p>'),
        })
      );

      withXml(source, (document) => {
        expect(document.documentElement.namespaceURI).toBe(
          'http://www.w3.org/1999/xhtml'
        );
        expect(document.getElementsByTagName('h1')[0]?.textContent).toBe(
          'An <&> article'
        );

        const meta = metaOf(document);

        expect(meta?.textContent).toContain('Go <Blog>');
        expect(meta?.textContent).toContain('2024-05-06');

        const link = meta?.getElementsByTagName('a')[0];

        expect(link?.getAttribute('href')).toBe(articleUrl);
        expect(document.getElementsByTagName('strong')[0]?.textContent).toBe(
          'text'
        );
      });
    })
);

it.effect(
  'KD-BOOK-3 keeps the heading and meta line for a chapter with no content',
  () =>
    Effect.gen(function* () {
      const source = yield* buildChapter(
        chapterOf({ title: titleOf('Only a heading') })
      );

      withXml(source, (document) => {
        expect(document.getElementsByTagName('h1')[0]?.textContent).toBe(
          'Only a heading'
        );
        expect(metaOf(document)).toBeDefined();
        expect(document.getElementsByTagName('p')).toHaveLength(1);
      });
    })
);

it.effect(
  'KD-BOOK-3 escapes titles and sources so the chapter stays well-formed XML',
  () =>
    Effect.gen(function* () {
      const source = yield* buildChapter(
        chapterOf({
          title: titleOf('A < B & C > D'),
          source: 'Go & Blog',
        })
      );

      expect(source).toContain('A &lt; B &amp; C &gt; D');
      expect(source).toContain('Go &amp; Blog');

      withXml(source, (document) => {
        expect(document.getElementsByTagName('h1')[0]?.textContent).toBe(
          'A < B & C > D'
        );
        expect(metaOf(document)?.textContent).toContain('Go & Blog');
      });
    })
);

it.effect(
  'KD-BOOK-3 writes the publish date only when the chapter has one',
  () =>
    Effect.gen(function* () {
      const source = yield* buildChapter(chapterOf());

      withXml(source, (document) => {
        expect(metaOf(document)?.textContent).not.toContain('2024-');
        expect(
          metaOf(document)?.getElementsByTagName('a')[0]?.textContent
        ).toBe(articleUrl);
      });
    })
);

it.effect(
  'KD-BOOK-5 keeps article text that is not wrapped in an element',
  () =>
    Effect.gen(function* () {
      const source = yield* buildChapter(
        chapterOf({ content: contentOf('Plain & simple') })
      );

      withXml(source, (document) => {
        expect(document.body.textContent).toContain('Plain & simple');
      });
    })
);
