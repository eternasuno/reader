import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  FeedFetchError,
  FeedFetcher,
  type FeedImport,
  FeedPreviewStore,
  FeedPreviewStoreError,
  FeedRepository,
  type PendingFeedPreview,
  prepareInitialImport,
  previewFeed,
  subscribeFeed,
} from '../../src';

const parsedFeed = {
  title: 'Example',
  description: 'Latest news',
  url: 'https://example.com/final.xml',
  articles: [
    {
      identity: 'one',
      url: 'https://example.com/one',
      title: 'One',
      publishedAt: '',
    },
  ],
};

it.effect(
  'previews a fetched feed once without touching the repository',
  () => {
    const fetched: string[] = [];
    const saved: {
      owner: string;
      url: string;
      expiresAt: number;
    }[] = [];

    return Effect.gen(function* () {
      expect(yield* previewFeed('alice', ' https://example.com/rss ')).toEqual({
        preview: {
          token: 'preview-token',
          url: 'https://example.com/final.xml',
          title: 'Example',
          description: 'Latest news',
          articleCount: 1,
        },
      });
      expect(fetched).toEqual(['https://example.com/rss']);
      expect(saved).toEqual([
        {
          owner: 'alice',
          url: 'https://example.com/final.xml',
          expiresAt: 10 * 60 * 1000,
        },
      ]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(FeedFetcher, {
            fetch: (url) => {
              fetched.push(url);

              return Effect.succeed(parsedFeed);
            },
          }),
          Layer.mock(FeedPreviewStore, {
            save: (preview, now) => {
              saved.push({
                owner: preview.owner,
                url: preview.url,
                expiresAt: preview.expiresAt,
              });
              expect(preview.imported).toEqual(
                prepareInitialImport(parsedFeed, '1970-01-01T00:00:00.000Z')
              );
              expect(now).toBe(0);

              return Effect.succeed('preview-token');
            },
          }),
          Layer.mock(FeedRepository, {})
        )
      )
    );
  }
);

it.effect(
  'previews the normalized address when the feed reports no final url',
  () =>
    Effect.gen(function* () {
      expect(yield* previewFeed('alice', 'https://example.com/rss')).toEqual({
        preview: {
          token: 'preview-token',
          url: 'https://example.com/rss',
          title: 'Example',
          description: '',
          articleCount: 0,
        },
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(FeedFetcher, {
            fetch: () => Effect.succeed({ title: 'Example', articles: [] }),
          }),
          Layer.mock(FeedPreviewStore, {
            save: () => Effect.succeed('preview-token'),
          }),
          Layer.mock(FeedRepository, {})
        )
      )
    )
);

it.effect('does not store a preview when fetching fails', () => {
  let saved = false;

  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      previewFeed('alice', 'https://example.com/rss')
    );
    expect(error._tag).toBe('FeedFetchError');
    expect(saved).toBe(false);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(FeedFetcher, {
          fetch: () => Effect.fail(new FeedFetchError({ error: 'down' })),
        }),
        Layer.mock(FeedPreviewStore, {
          save: () => {
            saved = true;

            return Effect.succeed('preview-token');
          },
        }),
        Layer.mock(FeedRepository, {})
      )
    )
  );
});

it.effect('keeps store failures distinct from fetch failures', () =>
  previewFeed('alice', 'https://x.co').pipe(
    Effect.flip,
    Effect.map((error) => expect(error._tag).toBe('FeedPreviewStoreError')),
    Effect.provideService(FeedFetcher, {
      fetch: () => Effect.succeed({ title: 'Example', articles: [] }),
    }),
    Effect.provide(
      Layer.mock(FeedPreviewStore, {
        save: () => Effect.fail(new FeedPreviewStoreError({ error: 'x' })),
      })
    )
  )
);

const confirmedFeed = {
  key: 'feed',
  url: 'https://example.com/rss',
  title: 'Example',
  updatedAt: '',
  error: '',
  unreadCount: 0,
};

const previewTimestamp = '2026-10-30T00:00:00.000Z';

const confirmationLayer = (
  created: { owner: string; url: string; now: string }[]
) =>
  Layer.mergeAll(
    Layer.mock(FeedPreviewStore, {
      find: (owner, token, now) => {
        expect([owner, token, now]).toEqual(['alice', 'preview-token', 0]);

        return Effect.succeed({
          owner,
          url: parsedFeed.url,
          imported: prepareInitialImport(parsedFeed, previewTimestamp),
          expiresAt: 10 * 60 * 1000,
        });
      },
    }),
    Layer.mock(FeedRepository, {
      createSubscribed: (owner, url, imported, now) => {
        expect(imported).toEqual({
          title: 'Example',
          articles: [
            {
              identity: 'one',
              url: 'https://example.com/one',
              title: 'One',
              publishedAt: previewTimestamp,
            },
          ],
          retention: 500,
        });
        created.push({ owner, url, now });

        return Effect.succeed(confirmedFeed);
      },
    }),
    Layer.mock(FeedFetcher, {})
  );

it.effect(
  'confirms a cached preview without fetching and retries the same token',
  () => {
    const created: { owner: string; url: string; now: string }[] = [];
    const confirmed = {
      owner: 'alice',
      url: parsedFeed.url,
      now: '1970-01-01T00:00:00.000Z',
    };

    return Effect.gen(function* () {
      expect(yield* subscribeFeed('alice', 'preview-token')).toEqual({
        item: confirmedFeed,
      });
      expect(yield* subscribeFeed('alice', 'preview-token')).toEqual({
        item: confirmedFeed,
      });
      expect(created).toEqual([confirmed, confirmed]);
    }).pipe(Effect.provide(confirmationLayer(created)));
  }
);

it.effect('rejects unknown and cross-owner preview tokens', () =>
  Effect.gen(function* () {
    expect((yield* Effect.flip(subscribeFeed('alice', 'unknown')))._tag).toBe(
      'InvalidPreview'
    );
    expect(
      (yield* Effect.flip(subscribeFeed('bob', 'preview-token')))._tag
    ).toBe('InvalidPreview');
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(FeedPreviewStore, {
          find: (owner, token) =>
            Effect.succeed(
              token === 'preview-token' && owner === 'alice'
                ? {
                    owner,
                    url: parsedFeed.url,
                    imported: prepareInitialImport(
                      parsedFeed,
                      previewTimestamp
                    ),
                    expiresAt: 0,
                  }
                : undefined
            ),
        }),
        Layer.mock(FeedRepository, {}),
        Layer.mock(FeedFetcher, {})
      )
    )
  )
);

it.effect(
  'previews every parsed article and imports only the newest initial batch',
  () => {
    const articles = Array.from({ length: 35 }, (_, index) => ({
      identity: String(index),
      url: `https://example.com/${index}`,
      title: String(index),
      publishedAt: new Date(index * 1000).toISOString(),
    }));
    let stored: PendingFeedPreview | undefined;
    let imported: FeedImport | undefined;
    let fetched = 0;
    const layer = Layer.mergeAll(
      Layer.succeed(FeedFetcher, {
        fetch: () => {
          fetched += 1;

          return Effect.succeed({ title: 'Example', articles });
        },
      }),
      Layer.mock(FeedPreviewStore, {
        save: (preview) => {
          stored = preview;

          return Effect.succeed('preview-token');
        },
        find: () => Effect.succeed(stored),
      }),
      Layer.mock(FeedRepository, {
        createSubscribed: (_owner, _url, value) => {
          imported = value;

          return Effect.succeed(confirmedFeed);
        },
      })
    );

    return Effect.gen(function* () {
      const { preview } = yield* previewFeed(
        'alice',
        'https://example.com/rss'
      );
      expect(preview.articleCount).toBe(35);
      expect(stored?.imported.articles).toHaveLength(30);
      expect(stored?.imported.articles[0]?.title).toBe('34');
      expect(yield* subscribeFeed('alice', 'preview-token')).toEqual({
        item: confirmedFeed,
      });
      expect(fetched).toBe(1);
      expect(imported).toBe(stored?.imported);
      expect(imported?.retention).toBe(500);
      expect(imported?.articles.map(({ title }) => title)).toEqual(
        Array.from({ length: 30 }, (_, index) => String(34 - index))
      );
    }).pipe(Effect.provide(layer));
  }
);
