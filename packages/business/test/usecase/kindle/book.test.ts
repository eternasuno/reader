import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { FeedTitle } from '../../../src/entity/feed/feed';
import type { Ebook } from '../../../src/port/epub-builder';
import { sendToKindle } from '../../../src/usecase/kindle/send-to-kindle';
import { alice, rowAt } from '../../support/fixtures';
import {
  captureBooks,
  runKindle,
  saveKindle,
  storeFeed,
  storeItems,
  storePage,
} from './harness';

const today = '2026-03-01';

describe('the order of the book', () => {
  it.effect(
    'KD-BOOK-2 saved pages first, then the feeds in list order, each in its stored order',
    () => {
      const books: Array<Ebook> = [];

      return runKindle(
        Effect.gen(function* () {
          yield* saveKindle();

          const beta = yield* storeFeed({
            title: FeedTitle.make('Beta'),
            order: 'newest',
          });
          const alpha = yield* storeFeed({
            title: FeedTitle.make('Alpha'),
            order: 'oldest',
          });
          const firstPage = yield* storePage();
          const secondPage = yield* storePage();
          const betaItems = yield* storeItems(beta, 2);
          const alphaItems = yield* storeItems(alpha, 2);

          expect(yield* sendToKindle(alice, today)).toEqual({ count: 6 });

          const chapters = rowAt(books, 0).chapters;

          expect(chapters.map((chapter) => chapter.url.href)).toEqual([
            firstPage.url.href,
            secondPage.url.href,
            rowAt(alphaItems, 0).url.href,
            rowAt(alphaItems, 1).url.href,
            rowAt(betaItems, 1).url.href,
            rowAt(betaItems, 0).url.href,
          ]);
          expect(chapters.map((chapter) => chapter.source)).toEqual([
            '稍后阅读',
            '稍后阅读',
            'Alpha',
            'Alpha',
            'Beta',
            'Beta',
          ]);
        }),
        { build: captureBooks(books) }
      );
    }
  );
});
