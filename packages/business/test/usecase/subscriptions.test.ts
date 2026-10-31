// biome-ignore-all lint/style/noExcessiveLinesPerFile: subscription workflow tests share one set of feed and store fixtures.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its mocks alongside the asserted scenario.
import { expect, it } from '@effect/vitest';
import { type Context, DateTime, Effect, Layer, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import {
  type Article,
  ArticleId,
  type Feed,
  OwnerId,
} from '../../src/entity/model';
import { ContentProcessor } from '../../src/port/content-processor';
import {
  type ArticleBoundary,
  Articles,
  ArticleWriteError,
  Subscriptions,
} from '../../src/port/reader-store';
import {
  FetchSubscriptionError,
  type SubscriptionEntry,
  type SyndicatedFeed,
  Syndication,
} from '../../src/port/syndication';
import { articleId, feedId, normalizeUrl } from '../../src/usecase/identity';
import {
  previewSubscription,
  refreshSubscription,
  subscribe,
} from '../../src/usecase/subscriptions';

const alice = OwnerId.make('alice');
const url = normalizeUrl('https://example.com/feed.xml');
const id = feedId(alice, url);
const nowMillis = Date.UTC(2026, 0, 1, 12);

const at = (iso: string) => DateTime.fromDateUnsafe(new Date(iso));

const encoded = (value: DateTime.Utc) =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(value);

const entry = (
  overrides: Partial<SubscriptionEntry> = {}
): SubscriptionEntry => ({
  title: 'One',
  url: new URL('https://example.com/one'),
  ...overrides,
});

const feed = (
  articles: readonly SubscriptionEntry[],
  title = 'News'
): SyndicatedFeed => ({ title, articles });

const subscription = (): Feed => ({
  id,
  ownerId: alice,
  url,
  title: 'Old',
  updatedAt: at('2025-12-01T00:00:00.000Z'),
});

const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layers: {
    readonly syndication?: Partial<Context.Service.Shape<typeof Syndication>>;
    readonly processor?: Partial<
      Context.Service.Shape<typeof ContentProcessor>
    >;
    readonly articles?: Partial<Context.Service.Shape<typeof Articles>>;
    readonly subscriptions?: Partial<
      Context.Service.Shape<typeof Subscriptions>
    >;
  }
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(Syndication, layers.syndication ?? {}),
        Layer.mock(ContentProcessor, {
          process: (content) => Effect.succeed(content),
          ...layers.processor,
        }),
        Layer.mock(Articles, layers.articles ?? {}),
        Layer.mock(Subscriptions, layers.subscriptions ?? {})
      )
    )
  );

it.effect('previews a subscription feed without persisting it', () => {
  const requested: string[] = [];

  return provide(
    Effect.gen(function* () {
      const preview = yield* previewSubscription(
        alice,
        ' https://Example.com/feed.xml?utm_source=x '
      );
      expect(preview.url.href).toBe(url.href);
      expect(preview.title).toBe('News');
      expect(preview.description).toBe('Daily');
      expect(preview.titles).toEqual(['First', 'Second', 'Third']);
      expect(requested).toEqual([url.href]);
    }),
    {
      subscriptions: { find: () => Effect.succeed(Option.none()) },
      syndication: {
        fetch: (target) => {
          requested.push(target.href);

          return Effect.succeed({
            title: 'News',
            description: 'Daily',
            articles: [
              entry({
                title: 'First',
                publishedAt: at('2026-01-03T00:00:00.000Z'),
              }),
              entry({
                title: 'Second',
                url: new URL('https://example.com/2'),
                publishedAt: at('2026-01-01T00:00:00.000Z'),
              }),
              entry({
                title: 'Third',
                url: new URL('https://example.com/3'),
              }),
              entry({
                title: 'Fourth',
                url: new URL('https://example.com/4'),
              }),
            ],
          });
        },
      },
    }
  );
});

it.effect(
  'reports a duplicate subscription during preview without fetching',
  () => {
    let fetched = false;

    return provide(
      Effect.gen(function* () {
        const error = yield* Effect.flip(previewSubscription(alice, url.href));
        expect(error._tag).toBe('SubscriptionExists');
        expect(error).toMatchObject({
          id,
          message: 'Subscription already exists',
        });
        expect(fetched).toBe(false);
      }),
      {
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
        },
        syndication: {
          fetch: () => {
            fetched = true;

            return Effect.succeed(feed([]));
          },
        },
      }
    );
  }
);

it.effect('rejects a non-HTTP subscription URL before fetching', () => {
  let fetched = false;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        previewSubscription(alice, 'ftp://example.com/feed')
      );
      expect(error._tag).toBe('SubscriptionUrlInvalid');
      expect(error.message).toBe('Subscription URL must use HTTP or HTTPS');
      expect(fetched).toBe(false);
    }),
    {
      syndication: {
        fetch: () => {
          fetched = true;

          return Effect.succeed(feed([]));
        },
      },
    }
  );
});

it.effect('surfaces feed fetch errors from the preview', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(previewSubscription(alice, url.href));
      expect(error._tag).toBe('FetchSubscriptionError');
      expect(error.message).toBe('failed');
    }),
    {
      subscriptions: { find: () => Effect.succeed(Option.none()) },
      syndication: {
        fetch: () =>
          Effect.fail(new FetchSubscriptionError({ message: 'failed' })),
      },
    }
  )
);

it.effect(
  'creates the subscription before importing the newest distinct articles',
  () => {
    const events: string[] = [];
    const created: (readonly Article[])[] = [];
    const processed: (readonly [string, boolean])[] = [];
    const newest = entry({
      title: 'Newest',
      url: new URL('https://example.com/newest'),
      description: 'Plain summary',
      descriptionText: true,
      content: '<p>Body</p>',
      contentText: false,
      publishedAt: at('2026-01-02T00:00:00.000Z'),
    });
    const older = entry({
      title: 'Older',
      url: new URL('https://example.com/older'),
      content: 'plain body',
      contentText: true,
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const undated = entry({
      title: 'Undated',
      url: new URL('https://example.com/undated'),
    });
    let stored: Feed | undefined;

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        const result = yield* subscribe(
          alice,
          'https://Example.com/feed.xml?utm_source=x'
        );
        expect(result.item).toEqual(stored);
        expect(stored).toMatchObject({
          id,
          ownerId: alice,
          url,
          title: 'News',
        });
        expect(
          encoded(stored?.updatedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-01T12:00:00.000Z');
        expect(events).toEqual(['subscription', 'articles']);
        expect(processed).toEqual([
          ['Plain summary', true],
          ['<p>Body</p>', false],
          ['plain body', true],
        ]);
        const items = created[0] ?? [];
        expect(items.map((item) => item.title)).toEqual([
          'Newest',
          'Undated',
          'Older',
        ]);
        expect(items[0]).toMatchObject({
          description: 'Plain summary',
          content: '<p>Body</p>',
          feedId: id,
          read: false,
        });
        expect(items[0]?.id).toBe(
          articleId(alice, id, newest.url, newest.title, newest.description)
        );
        expect(
          encoded(items[0]?.publishedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-02T00:00:00.000Z');
        expect(items[2]).toMatchObject({ content: 'plain body' });
        expect(
          encoded(items[1]?.publishedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-01T12:00:00.000Z');
      }),
      {
        syndication: {
          fetch: () =>
            Effect.succeed(feed([older, undated, newest, { ...newest }])),
        },
        subscriptions: {
          find: () => Effect.succeed(Option.none()),
          create: (item) => {
            events.push('subscription');
            stored = item;

            return Effect.succeed(true);
          },
        },
        processor: {
          process: (content, text) => {
            processed.push([content, text]);

            return Effect.succeed(content);
          },
        },
        articles: {
          create: (_owner, items) => {
            events.push('articles');
            created.push(items);

            return Effect.succeed(items.map((item) => item.id));
          },
        },
      }
    );
  }
);

it.effect('imports entries without a URL', () => {
  const created: (readonly Article[])[] = [];
  const linkless = entry({
    title: 'No URL',
    url: undefined,
    content: 'plain body',
    contentText: true,
  });

  return provide(
    Effect.gen(function* () {
      yield* subscribe(alice, url.href);
      const items = created[0] ?? [];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'No URL',
        content: 'plain body',
        feedId: id,
      });
      expect(items[0]?.url).toBeUndefined();
      expect(items[0]?.id).toBe(
        articleId(alice, id, undefined, 'No URL', undefined)
      );
    }),
    {
      syndication: { fetch: () => Effect.succeed(feed([linkless])) },
      subscriptions: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed(true),
      },
      articles: {
        create: (_owner, items) => {
          created.push(items);

          return Effect.succeed(items.map((item) => item.id));
        },
      },
    }
  );
});

it.effect('imports at most 30 articles from a large feed', () => {
  const created: (readonly Article[])[] = [];
  const entries = Array.from({ length: 35 }, (_, index) =>
    entry({
      title: `Article ${index}`,
      url: new URL(`https://example.com/${index}`),
      publishedAt: at(new Date(nowMillis + index * 60_000).toISOString()),
    })
  );

  return provide(
    Effect.gen(function* () {
      yield* subscribe(alice, url.href);
      const items = created[0] ?? [];
      expect(items).toHaveLength(30);
      expect(items[0]?.title).toBe('Article 34');
      expect(items[29]?.title).toBe('Article 5');
    }),
    {
      syndication: { fetch: () => Effect.succeed(feed(entries)) },
      subscriptions: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed(true),
      },
      articles: {
        create: (_owner, items) => {
          created.push(items);

          return Effect.succeed(items.map((item) => item.id));
        },
      },
    }
  );
});

it.effect('reports a duplicate subscription without fetching the feed', () => {
  let fetched = false;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(subscribe(alice, url.href));
      expect(error._tag).toBe('SubscriptionExists');
      expect(error).toMatchObject({
        id,
        message: 'Subscription already exists',
      });
      expect(fetched).toBe(false);
    }),
    {
      subscriptions: {
        find: () => Effect.succeed(Option.some(subscription())),
      },
      syndication: {
        fetch: () => {
          fetched = true;

          return Effect.succeed(feed([]));
        },
      },
    }
  );
});

it.effect('reports a duplicate subscription when creation loses a race', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(subscribe(alice, url.href));
      expect(error._tag).toBe('SubscriptionExists');
      expect(error).toMatchObject({ id });
    }),
    {
      subscriptions: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed(false),
      },
      syndication: { fetch: () => Effect.succeed(feed([])) },
    }
  )
);

it.effect('reports an article write failure as an import failure', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(subscribe(alice, url.href));
      expect(error._tag).toBe('SubscriptionImportFailed');
      expect(error).toMatchObject({
        id,
        message: 'Failed to import subscription articles',
      });
    }),
    {
      subscriptions: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed(true),
      },
      syndication: { fetch: () => Effect.succeed(feed([entry()])) },
      articles: {
        create: () =>
          Effect.fail(new ArticleWriteError({ message: 'write failed' })),
      },
    }
  )
);

it.effect('does not fetch a missing subscription', () => {
  let fetched = false;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(refreshSubscription(alice, id));
      expect(error._tag).toBe('SubscriptionNotFound');
      expect(error).toMatchObject({
        id,
        message: 'Subscription not found',
      });
      expect(fetched).toBe(false);
    }),
    {
      subscriptions: { find: () => Effect.succeed(Option.none()) },
      syndication: {
        fetch: () => {
          fetched = true;

          return Effect.succeed(feed([]));
        },
      },
    }
  );
});

it.effect(
  'keeps existing articles first on ties and imports only retained new ones',
  () => {
    const events: string[] = [];
    const created: (readonly Article[])[] = [];
    const retained: (readonly ArticleId[])[] = [];
    const processed: string[] = [];
    const knownUrl = new URL('https://example.com/known');
    const knownId = articleId(alice, id, knownUrl, 'Known', undefined);
    const tied = entry({
      title: 'Tied',
      url: new URL('https://example.com/tied'),
      content: '<p>Tied body</p>',
      publishedAt: at('2026-01-02T00:00:00.000Z'),
    });
    const known = entry({ title: 'Known', url: knownUrl });
    const inventory: ArticleBoundary[] = [
      {
        id: ArticleId.make('b'.repeat(64)),
        publishedAt: '2026-01-02T00:00:00.000Z',
      },
      { id: knownId, publishedAt: '2026-01-01T00:00:00.000Z' },
    ];
    let updated: Feed | undefined;

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        const result = yield* refreshSubscription(alice, id);
        expect(events).toEqual(['articles', 'retain', 'update']);
        expect(created[0]?.map((item) => item.title)).toEqual(['Tied']);
        expect(retained[0]).toEqual([
          ArticleId.make('b'.repeat(64)),
          articleId(alice, id, tied.url, tied.title, tied.description),
          knownId,
        ]);
        expect(processed).toEqual(['<p>Tied body</p>']);
        expect(updated).toMatchObject({ id, url, title: 'Updated' });
        expect(
          encoded(updated?.updatedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-01T12:00:00.000Z');
        expect(result.item).toEqual(updated);
      }),
      {
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
          retention: () => Effect.succeed(100),
          update: (item) =>
            Effect.sync(() => {
              events.push('update');
              updated = item;
            }),
        },
        syndication: {
          fetch: () => Effect.succeed(feed([tied, known], 'Updated')),
        },
        processor: {
          process: (content) => {
            processed.push(content);

            return Effect.succeed(content);
          },
        },
        articles: {
          inventory: () => Effect.succeed(inventory),
          create: (_owner, items) =>
            Effect.sync(() => {
              events.push('articles');
              created.push(items);

              return items.map((item) => item.id);
            }),
          retain: (_owner, _feedId, ids) =>
            Effect.sync(() => {
              events.push('retain');
              retained.push(ids);
            }),
        },
      }
    );
  }
);

it.effect('keeps the configured retention and drops older new articles', () => {
  const hex = (value: number) => value.toString(16).padStart(64, '0');
  const inventory: ArticleBoundary[] = Array.from(
    { length: 100 },
    (_, index) => ({
      id: ArticleId.make(hex(index)),
      publishedAt: new Date(nowMillis + index * 60_000).toISOString(),
    })
  );
  const created: (readonly Article[])[] = [];
  const retained: (readonly ArticleId[])[] = [];
  let processed = false;

  return provide(
    Effect.gen(function* () {
      yield* refreshSubscription(alice, id);
      expect(created).toEqual([]);
      expect(processed).toBe(false);
      expect(retained[0]).toHaveLength(50);
      expect(retained[0]?.[0]).toBe(ArticleId.make(hex(99)));
      expect(retained[0]?.[49]).toBe(ArticleId.make(hex(50)));
    }),
    {
      subscriptions: {
        find: () => Effect.succeed(Option.some(subscription())),
        retention: () => Effect.succeed(50),
        update: () => Effect.void,
      },
      syndication: {
        fetch: () =>
          Effect.succeed(
            feed([entry({ publishedAt: at('2026-01-01T00:00:00.000Z') })])
          ),
      },
      processor: {
        process: (content) => {
          processed = true;

          return Effect.succeed(content);
        },
      },
      articles: {
        inventory: () => Effect.succeed(inventory),
        create: (_owner, items) => {
          created.push(items);

          return Effect.succeed(items.map((item) => item.id));
        },
        retain: (_owner, _feedId, ids) => {
          retained.push(ids);

          return Effect.void;
        },
      },
    }
  );
});

it.effect(
  'imports the newest copy when a feed repeats an article identity',
  () => {
    const created: (readonly Article[])[] = [];
    const retained: (readonly ArticleId[])[] = [];
    const repeated = new URL('https://example.com/repeated');
    const stale = entry({
      title: 'Repeated',
      url: repeated,
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const newest = entry({
      title: 'Repeated',
      url: repeated,
      publishedAt: at('2026-01-05T00:00:00.000Z'),
    });
    const newestId = articleId(
      alice,
      id,
      repeated,
      newest.title,
      newest.description
    );

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        yield* refreshSubscription(alice, id);
        expect(created[0]?.map((item) => item.title)).toEqual(['Repeated']);
        expect(created[0]?.[0]?.publishedAt).toEqual(
          at('2026-01-05T00:00:00.000Z')
        );
        expect(retained[0]).toEqual([newestId]);
      }),
      {
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
          retention: () => Effect.succeed(100),
          update: () => Effect.void,
        },
        syndication: {
          fetch: () => Effect.succeed(feed([stale, newest])),
        },
        articles: {
          inventory: () => Effect.succeed([]),
          create: (_owner, items) => {
            created.push(items);

            return Effect.succeed(items.map((item) => item.id));
          },
          retain: (_owner, _feedId, ids) => {
            retained.push(ids);

            return Effect.void;
          },
        },
      }
    );
  }
);

it.effect(
  'retains the newest duplicated article over older existing ones',
  () => {
    const created: (readonly Article[])[] = [];
    const retained: (readonly ArticleId[])[] = [];
    const repeated = new URL('https://example.com/repeated');
    const stale = entry({
      title: 'Repeated',
      url: repeated,
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const fresh = entry({
      title: 'Fresh',
      url: new URL('https://example.com/fresh'),
      publishedAt: at('2026-01-15T00:00:00.000Z'),
    });
    const newest = entry({
      title: 'Repeated',
      url: repeated,
      publishedAt: at('2026-01-20T00:00:00.000Z'),
    });
    const newestId = articleId(
      alice,
      id,
      repeated,
      newest.title,
      newest.description
    );
    const freshId = articleId(alice, id, fresh.url, fresh.title, undefined);
    const inventory: ArticleBoundary[] = [
      {
        id: ArticleId.make('c'.repeat(64)),
        publishedAt: '2026-01-10T00:00:00.000Z',
      },
      {
        id: ArticleId.make('d'.repeat(64)),
        publishedAt: '2026-01-09T00:00:00.000Z',
      },
    ];

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        yield* refreshSubscription(alice, id);
        expect(created[0]?.map((item) => item.title)).toEqual([
          'Repeated',
          'Fresh',
        ]);
        expect(created[0]?.[0]?.publishedAt).toEqual(
          at('2026-01-20T00:00:00.000Z')
        );
        expect(retained[0]).toEqual([newestId, freshId]);
      }),
      {
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
          retention: () => Effect.succeed(2),
          update: () => Effect.void,
        },
        syndication: {
          fetch: () => Effect.succeed(feed([stale, fresh, newest])),
        },
        articles: {
          inventory: () => Effect.succeed(inventory),
          create: (_owner, items) => {
            created.push(items);

            return Effect.succeed(items.map((item) => item.id));
          },
          retain: (_owner, _feedId, ids) => {
            retained.push(ids);

            return Effect.void;
          },
        },
      }
    );
  }
);

it.effect(
  'reports a refresh write failure with the subscription identity',
  () =>
    provide(
      Effect.gen(function* () {
        const error = yield* Effect.flip(refreshSubscription(alice, id));
        expect(error._tag).toBe('SubscriptionRefreshFailed');
        expect(error).toMatchObject({
          id,
          message: 'Failed to refresh subscription',
        });
      }),
      {
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
          retention: () => Effect.succeed(100),
        },
        syndication: { fetch: () => Effect.succeed(feed([])) },
        articles: {
          inventory: () => Effect.succeed([]),
          retain: () =>
            Effect.fail(new ArticleWriteError({ message: 'retain failed' })),
        },
      }
    )
);
