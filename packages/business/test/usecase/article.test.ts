import { expect, it } from '@effect/vitest';
import { Effect, Layer, Redacted } from 'effect';
import {
  ArticleExtractor,
  ArticleRepository,
  ReaderCredentials,
  readArticle,
  saveReaderKey,
  WebpageFetcher,
} from '../../src';
import {
  browserCredentials,
  browserFetcher,
  cachedRepository,
  credentialsDown,
  expectPropagatedFailure,
  extractDown,
  failingCredentials,
  failingExtractor,
  failingFetcher,
  failingRepository,
  fetchDown,
  noCredentials,
  noExtractor,
  noFetcher,
  repositoryDown,
} from './article-support';

const unavailable = Layer.mergeAll(noCredentials, noFetcher, noExtractor);

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

const sourceUrl = 'https://example.com/a';

it.effect('extracts with the browser provider without a stored key', () =>
  Effect.gen(function* () {
    const result = yield* readArticle('alice', 'link', 'key', true, true);
    expect(result.item).toEqual({
      url: sourceUrl,
      title: 'Browser',
      html: '<p>Browser</p>',
      extractedAt: expect.any(String),
    });
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ReaderCredentials, {
          provider: () => Effect.succeed('browser'),
          browserEndpoint: () => Effect.succeed('http://127.0.0.1:9222'),
          get: () => Effect.die('browser provider must not read the key'),
        }),
        Layer.mock(WebpageFetcher, {
          fetch: (url, key, provider, endpoint) => {
            expect(url).toBe(sourceUrl);
            expect(key).toBeUndefined();
            expect(provider).toBe('browser');
            expect(endpoint).toBe('http://127.0.0.1:9222');

            return Effect.succeed('<html>browser</html>');
          },
        }),
        Layer.mock(ArticleExtractor, {
          extract: () =>
            Effect.succeed({ title: 'Browser', html: '<p>Browser</p>' }),
        }),
        cachedRepository
      )
    )
  )
);

it.effect('extracts with jina using the stored key', () =>
  Effect.gen(function* () {
    const result = yield* readArticle('alice', 'link', 'key', true, true);
    expect(result.item?.title).toBe('Jina');
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ReaderCredentials, {
          provider: () => Effect.succeed('jina'),
          get: () => Effect.succeed(Redacted.make('jina-key')),
        }),
        Layer.mock(WebpageFetcher, {
          fetch: (_, key, provider, endpoint) => {
            const value = key ? Redacted.value(key) : undefined;
            expect(value).toBe('jina-key');
            expect(provider).toBe('jina');
            expect(endpoint).toBeUndefined();

            return Effect.succeed('<html>jina</html>');
          },
        }),
        Layer.mock(ArticleExtractor, {
          extract: () => Effect.succeed({ title: 'Jina', html: '<p>Jina</p>' }),
        }),
        cachedRepository
      )
    )
  )
);

it.effect('rejects jina extraction when no key is stored', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      readArticle('alice', 'link', 'key', true, true)
    );
    expect(error.error).toBe('请先在设置中填写 Jina API Key');
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ReaderCredentials, {
          provider: () => Effect.succeed('jina'),
          get: () => Effect.undefined,
        }),
        Layer.mock(WebpageFetcher, {
          fetch: () => Effect.die('jina without a key must not fetch'),
        }),
        Layer.mock(ArticleExtractor, {}),
        cachedRepository
      )
    )
  )
);

it.effect('rejects browser extraction when no endpoint is saved', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      readArticle('alice', 'link', 'key', true, true)
    );
    expect(error._tag).toBe('ArticleFailure');
    expect(error.error).toBe('请先在设置中填写浏览器服务地址');
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ReaderCredentials, {
          provider: () => Effect.succeed('browser'),
          browserEndpoint: () => Effect.undefined,
        }),
        Layer.mock(WebpageFetcher, {
          fetch: () => Effect.die('browser without an endpoint must not fetch'),
        }),
        Layer.mock(ArticleExtractor, {}),
        cachedRepository
      )
    )
  )
);

it.effect('propagates repository failures without relabeling them', () =>
  expectPropagatedFailure(
    Layer.mergeAll(failingRepository, noCredentials, noFetcher, noExtractor),
    'ArticleRepositoryError',
    repositoryDown
  )
);

it.effect('propagates reader credential failures without relabeling them', () =>
  expectPropagatedFailure(
    Layer.mergeAll(
      cachedRepository,
      failingCredentials,
      noFetcher,
      noExtractor
    ),
    'ReaderCredentialsError',
    credentialsDown
  )
);

it.effect('propagates webpage fetch failures without relabeling them', () =>
  expectPropagatedFailure(
    Layer.mergeAll(
      cachedRepository,
      browserCredentials,
      failingFetcher,
      noExtractor
    ),
    'WebpageFetchError',
    fetchDown
  )
);

it.effect(
  'propagates article extraction failures without relabeling them',
  () =>
    expectPropagatedFailure(
      Layer.mergeAll(
        cachedRepository,
        browserCredentials,
        browserFetcher,
        failingExtractor
      ),
      'ArticleExtractError',
      extractDown
    )
);

it.effect('rejects invalid keys as a business failure', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(saveReaderKey('alice', ' '));
    expect(error._tag).toBe('ArticleFailure');
  }).pipe(Effect.provide(Layer.mock(ReaderCredentials, {})))
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
