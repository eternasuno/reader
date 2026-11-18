import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
} from '../../../src/entity/common/article';
import { WebpageFetcherError } from '../../../src/error/common';
import type { Ebook } from '../../../src/port/epub-builder';
import { sendToKindle } from '../../../src/usecase/kindle/send-to-kindle';
import { alice, rowAt } from '../../support/fixtures';
import { pageHtml } from '../common/harness';
import {
  captureBooks,
  readFlags,
  runKindle,
  saveKindle,
  storedItemRows,
  storeFeed,
  storeItems,
} from './harness';

const today = '2026-03-01';

const content = (html: string): Option.Option<ArticleContent> =>
  Option.some(ArticleContent.make(html));

const description = (text: string): Option.Option<ArticleDescription> =>
  Option.some(ArticleDescription.make(text));

/** The text of every chapter of the one book, in book order (KD-TEXT). */
const contentsOf = (
  books: ReadonlyArray<Ebook>
): ReadonlyArray<string | undefined> =>
  rowAt(books, 0).chapters.map((chapter) =>
    Option.getOrUndefined(chapter.content)
  );

/** The text the one chapter of the book holds. */
const onlyContent = (books: ReadonlyArray<Ebook>): string | undefined =>
  Option.getOrUndefined(rowAt(rowAt(books, 0).chapters, 0).content);

describe('a default feed', () => {
  it.effect(
    'KD-TEXT-2 uses the content, else the description, else nothing',
    () => {
      const books: Array<Ebook> = [];

      return runKindle(
        Effect.gen(function* () {
          yield* saveKindle();

          const feed = yield* storeFeed();

          yield* storeItems(feed, 1, {
            content: content('<p>Content</p>'),
            description: description('<p>Description</p>'),
          });
          yield* storeItems(feed, 1, {
            description: description('<p>Description</p>'),
          });
          yield* storeItems(feed, 1);

          yield* sendToKindle(alice, today);

          expect(contentsOf(books)).toEqual([
            '<p>Content</p>',
            '<p>Description</p>',
            undefined,
          ]);
        }),
        { build: captureBooks(books) }
      );
    }
  );
});

describe('an extracted feed', () => {
  it.effect('KD-TEXT-3 uses the stored extraction without fetching', () => {
    const books: Array<Ebook> = [];
    const fetched: Array<string> = [];

    return runKindle(
      Effect.gen(function* () {
        yield* saveKindle();

        const feed = yield* storeFeed({ readerMode: 'extracted' });

        yield* storeItems(feed, 1, {
          content: content('<p>Content</p>'),
          extractedContent: content('<p>Stored</p>'),
        });

        yield* sendToKindle(alice, today);

        expect(onlyContent(books)).toBe('<p>Stored</p>');
        expect(fetched).toEqual([]);
      }),
      {
        build: captureBooks(books),
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed(pageHtml);
        },
      }
    );
  });
});

describe('an embedded feed', () => {
  it.effect('KD-TEXT-3 extracts once and stores what it extracted', () => {
    const books: Array<Ebook> = [];
    const fetched: Array<string> = [];

    return runKindle(
      Effect.gen(function* () {
        yield* saveKindle();

        const feed = yield* storeFeed({ readerMode: 'embedded' });

        yield* storeItems(feed, 1);
        yield* sendToKindle(alice, today);

        const stored = rowAt(yield* storedItemRows(), 0);

        expect(onlyContent(books)).toBe('<p>Fetched</p>');
        expect(fetched).toHaveLength(1);
        expect(Option.getOrUndefined(stored.extractedContent)).toBe(
          '<p>Fetched</p>'
        );
      }),
      {
        build: captureBooks(books),
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed(pageHtml);
        },
      }
    );
  });
});

describe('a failed extraction', () => {
  it.effect(
    'KD-TEXT-4 falls back to the content and the item is still read',
    () => {
      const books: Array<Ebook> = [];

      return runKindle(
        Effect.gen(function* () {
          yield* saveKindle();

          const feed = yield* storeFeed({ readerMode: 'extracted' });

          yield* storeItems(feed, 1, { content: content('<p>Content</p>') });

          expect(yield* sendToKindle(alice, today)).toEqual({ count: 1 });
          expect(onlyContent(books)).toBe('<p>Content</p>');
          expect(readFlags(yield* storedItemRows())).toEqual([true]);
        }),
        {
          build: captureBooks(books),
          fetch: () =>
            Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
        }
      );
    }
  );
});
