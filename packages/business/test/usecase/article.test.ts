import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  ArticleExtractor,
  ArticleRepository,
  ReaderCredentials,
  readArticle,
  WebpageFetcher,
} from '../../src';

const unavailable = Layer.mergeAll(
  Layer.mock(ReaderCredentials, {}),
  Layer.mock(WebpageFetcher, {}),
  Layer.mock(ArticleExtractor, {})
);

it.effect(
  'reads cached content without credentials or external requests',
  () => {
    const item = {
      url: 'https://example.com/a',
      title: 'Cached',
      html: '<p>Cached</p>',
      extractedAt: '2026-10-17T00:00:00Z',
    };

    return Effect.gen(function* () {
      const result = yield* readArticle('alice', 'link', 'key', false, false);
      expect(result.item).toEqual(item);
      expect(result.source).toEqual({
        title: 'Source',
        url: item.url,
        read: false,
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          unavailable,
          Layer.mock(ArticleRepository, {
            metadata: (owner) => {
              expect(owner).toBe('alice');
              return Effect.succeed({
                title: 'Source',
                url: item.url,
                read: false,
              });
            },
            get: () => Effect.succeed(item),
          })
        )
      )
    );
  }
);

it.effect(
  'rejects unowned articles before reading cache or calling providers',
  () =>
    Effect.gen(function* () {
      expect(
        (yield* Effect.flip(readArticle('bob', 'feed', 'private', false, true)))
          ._tag
      ).toBe('ArticleFailure');
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          unavailable,
          Layer.mock(ArticleRepository, {
            metadata: () => Effect.undefined,
          })
        )
      )
    )
);

it.effect('does not extract automatically on a cache miss', () =>
  Effect.gen(function* () {
    expect(yield* readArticle('alice', 'link', 'key', false, false)).toEqual({
      item: null,
      source: {
        title: 'Feed',
        url: 'https://example.com',
        read: false,
        description: '<p>RSS</p>',
      },
    });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        unavailable,
        Layer.mock(ArticleRepository, {
          metadata: () =>
            Effect.succeed({
              title: 'Feed',
              url: 'https://example.com',
              read: false,
              description: '<p>RSS</p>',
            }),
          get: () => Effect.undefined,
        })
      )
    )
  )
);
