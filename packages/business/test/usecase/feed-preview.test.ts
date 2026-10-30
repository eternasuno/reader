import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  FeedFetchError,
  FeedFetcher,
  FeedPreviewStore,
  FeedRepository,
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
              expect(preview.feed).toBe(parsedFeed);
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

const confirmedFeed = {
  key: 'feed',
  url: 'https://example.com/rss',
  title: 'Example',
  updatedAt: '',
  error: '',
  unreadCount: 0,
};

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
          feed: parsedFeed,
          expiresAt: 10 * 60 * 1000,
        });
      },
    }),
    Layer.mock(FeedRepository, {
      createSubscribed: (owner, url, feed, now) => {
        expect(feed).toBe(parsedFeed);
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
                    feed: parsedFeed,
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
