// biome-ignore-all lint/style/noExcessiveLinesPerFile: scheduler tests share feed fixtures and mock layer assembly.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its mocks alongside the asserted scenario.
import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  DocumentSanitizer,
  type Feed,
  FeedId,
  FeedItemRepository,
  FeedParser,
  FeedRepository,
  NormalizedUrl,
  OptionFromOptionalNonEmpty,
  OwnerId,
  Retention,
  SettingsRepository,
} from '@reader/business';
import {
  type Context,
  DateTime,
  Deferred,
  type Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { TestClock } from 'effect/testing';
import { FeedFetcherLive } from '../../src/adapter/feed-fetcher';
import { HtmlParserLive } from '../../src/adapter/html-parser';
import { SubscriptionSchedulerLive } from '../../src/infrastructure/subscription-scheduler';
import {
  type SubscriptionSchedule,
  SubscriptionSchedules,
} from '../../src/infrastructure/subscription-schedules';

type Mocks = {
  readonly schedules:
    | ReadonlyArray<SubscriptionSchedule>
    | (() => ReadonlyArray<SubscriptionSchedule>);
  readonly subscriptions?: Partial<
    Context.Service.Shape<typeof FeedRepository>
  >;
  readonly http?: (url: URL) => Effect.Effect<Response>;
  readonly parser?: Partial<Context.Service.Shape<typeof FeedParser>>;
  readonly items?: Partial<Context.Service.Shape<typeof FeedItemRepository>>;
  readonly processor?: Partial<Context.Service.Shape<typeof DocumentSanitizer>>;
};

const feedId = (seed: string) => FeedId.make(seed.repeat(64).slice(0, 64));

const owner = (value: string) => OwnerId.make(value);

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const decodeRetention = Schema.decodeSync(Retention);

const decodeSanitized = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

const schedule = (ownerId: string, interval: Duration.Input) => ({
  ownerId: owner(ownerId),
  interval,
});

const subscription = (ownerId: string, id: FeedId, url: string): Feed => ({
  id,
  ownerId: owner(ownerId),
  url: decodeUrl(url),
  title: url,
  updatedAt: DateTime.fromDateUnsafe(new Date('2026-01-01T00:00:00.000Z')),
});

const feed = {
  title: 'Feed',
  url: decodeUrl('https://example.com/feed'),
  description: Option.none(),
  items: [],
};

const document = () => new Response('<rss/>', { status: 200 });

const httpClient = (
  respond: (url: URL) => Effect.Effect<Response>
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.map(respond(url), (response) =>
        HttpClientResponse.fromWeb(request, response)
      )
    )
  );

const schedulesLayer = (mocks: Mocks) =>
  Layer.succeed(
    SubscriptionSchedules,
    SubscriptionSchedules.of({
      list: () =>
        Effect.sync(() =>
          typeof mocks.schedules === 'function'
            ? mocks.schedules()
            : mocks.schedules
        ),
    })
  );

const scheduler = (mocks: Mocks) =>
  SubscriptionSchedulerLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        schedulesLayer(mocks),
        Layer.mock(FeedRepository, mocks.subscriptions ?? {}),
        Layer.mock(SettingsRepository, {
          get: (owner) =>
            Effect.succeed({
              ownerId: owner,
              feed: { retention: decodeRetention(100) },
              fetcher: {
                provider: 'jina' as const,
                jina: { key: Option.none() },
                browser: { endpoint: Option.none() },
              },
            }),
        }),
        FeedFetcherLive.pipe(
          Layer.provide(
            httpClient(mocks.http ?? (() => Effect.succeed(document())))
          )
        ),
        Layer.mock(FeedParser, {
          parse: () => Effect.succeed(feed),
          ...mocks.parser,
        }),
        Layer.mock(FeedItemRepository, mocks.items ?? {}),
        Layer.mock(DocumentSanitizer, {
          sanitize: () => Effect.succeed(decodeSanitized(undefined)),
          ...mocks.processor,
        }),
        HtmlParserLive
      )
    )
  );

const findById =
  (items: ReadonlyArray<Feed>) => (_owner: OwnerId, id: FeedId) =>
    Effect.succeed(Option.fromNullishOr(items.find((item) => item.id === id)));

const ownedBy = (items: ReadonlyArray<Feed>) => (ownerId: OwnerId) =>
  Effect.succeed(items.filter((item) => item.ownerId === ownerId));

it.effect(
  'refreshes every discovered owner immediately, scoped to its own feeds',
  () => {
    const items = [
      subscription('alice', feedId('a'), 'https://example.com/a.xml'),
      subscription('alice', feedId('b'), 'https://example.com/b.xml'),
      subscription('bob', feedId('c'), 'https://example.com/c.xml'),
    ];
    const listed: Array<string> = [];
    const fetched: Array<string> = [];
    const done = Deferred.makeUnsafe<void>();

    return Effect.gen(function* () {
      yield* Deferred.await(done);
      expect([...listed].sort()).toEqual(['alice', 'bob']);
      expect([...fetched].sort()).toEqual(
        items.map((item) => item.url.href).sort()
      );
    }).pipe(
      Effect.provide(
        scheduler({
          schedules: [
            schedule('alice', '30 minutes'),
            schedule('bob', '30 minutes'),
          ],
          subscriptions: {
            list: (ownerId) =>
              Effect.gen(function* () {
                listed.push(ownerId);

                return yield* ownedBy(items)(ownerId);
              }),
            find: findById(items),
            update: () => Effect.void,
          },
          http: (url) =>
            Effect.gen(function* () {
              fetched.push(url.href);
              if (fetched.length === items.length) {
                yield* Deferred.succeed(done, undefined);
              }

              return document();
            }),
          items: {
            inventory: () => Effect.succeed([]),
            retain: () => Effect.void,
          },
        })
      )
    );
  }
);

it.effect('runs independent owner schedules at their own intervals', () => {
  const alice = subscription(
    'alice',
    feedId('d'),
    'https://example.com/alice.xml'
  );
  const bob = subscription('bob', feedId('e'), 'https://example.com/bob.xml');
  const fetches = new Map<string, number>();
  const started = Deferred.makeUnsafe<void>();
  const aliceAgain = Deferred.makeUnsafe<void>();
  const bobAgain = Deferred.makeUnsafe<void>();

  const fetchCount = () =>
    [...fetches.values()].reduce((sum, count) => sum + count, 0);

  return Effect.gen(function* () {
    yield* Deferred.await(started);
    expect(fetches.get(alice.url.href)).toBe(1);
    expect(fetches.get(bob.url.href)).toBe(1);

    yield* TestClock.adjust('30 minutes');
    yield* Deferred.await(aliceAgain);
    expect(fetches.get(alice.url.href)).toBe(2);
    expect(fetches.get(bob.url.href)).toBe(1);

    yield* TestClock.adjust('30 minutes');
    yield* Deferred.await(bobAgain);
    expect(fetches.get(alice.url.href)).toBe(3);
    expect(fetches.get(bob.url.href)).toBe(2);
  }).pipe(
    Effect.provide(
      scheduler({
        schedules: [schedule('alice', '30 minutes'), schedule('bob', '1 hour')],
        subscriptions: {
          list: ownedBy([alice, bob]),
          find: findById([alice, bob]),
          update: () => Effect.void,
        },
        http: (url) =>
          Effect.gen(function* () {
            const count = (fetches.get(url.href) ?? 0) + 1;
            fetches.set(url.href, count);
            if (fetchCount() === 2) {
              yield* Deferred.succeed(started, undefined);
            }

            const repeat = url.href === alice.url.href ? aliceAgain : bobAgain;
            if (count === 2) {
              yield* Deferred.succeed(repeat, undefined);
            }

            return document();
          }),
        items: {
          inventory: () => Effect.succeed([]),
          retain: () => Effect.void,
        },
      })
    )
  );
});

it.effect(
  'does not refresh an owner while its refresh is still running',
  () => {
    const item = subscription(
      'alice',
      feedId('f'),
      'https://example.com/f.xml'
    );
    let fetches = 0;
    let updates = 0;
    const started = Deferred.makeUnsafe<void>();
    const gate = Deferred.makeUnsafe<void>();
    const finished = Deferred.makeUnsafe<void>();

    return Effect.gen(function* () {
      yield* Deferred.await(started);
      yield* TestClock.adjust('30 minutes');
      expect(fetches).toBe(1);

      yield* Deferred.succeed(gate, undefined);
      yield* Deferred.await(finished);
      expect(fetches).toBe(1);
      expect(updates).toBe(1);
    }).pipe(
      Effect.provide(
        scheduler({
          schedules: [schedule('alice', '30 minutes')],
          subscriptions: {
            list: ownedBy([item]),
            find: findById([item]),
            update: () =>
              Effect.gen(function* () {
                updates += 1;
                yield* Deferred.succeed(finished, undefined);
              }),
          },
          http: () =>
            Effect.gen(function* () {
              fetches += 1;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(gate);

              return document();
            }),
          items: {
            inventory: () => Effect.succeed([]),
            retain: () => Effect.void,
          },
        })
      )
    );
  }
);

it.effect(
  'logs a failed owner refresh and retries on the next interval',
  () => {
    const item = subscription(
      'alice',
      feedId('g'),
      'https://example.com/g.xml'
    );
    let attempts = 0;
    const first = Deferred.makeUnsafe<void>();
    const second = Deferred.makeUnsafe<void>();

    return Effect.gen(function* () {
      yield* Deferred.await(first);
      yield* Effect.yieldNow;
      yield* TestClock.adjust('30 minutes');
      yield* Deferred.await(second);
      expect(attempts).toBe(2);
    }).pipe(
      Effect.provide(
        scheduler({
          schedules: [schedule('alice', '30 minutes')],
          subscriptions: {
            list: ownedBy([item]),
            find: findById([item]),
            update: () => Effect.void,
          },
          http: () =>
            Effect.gen(function* () {
              attempts += 1;
              if (attempts === 1) {
                yield* Deferred.succeed(first, undefined);

                return new Response('no', { status: 503 });
              }

              yield* Deferred.succeed(second, undefined);

              return document();
            }),
          items: {
            inventory: () => Effect.succeed([]),
            retain: () => Effect.void,
          },
        })
      )
    );
  }
);

it.effect('isolates a failing subscription from the rest of the owner', () => {
  const broken = subscription(
    'alice',
    feedId('h'),
    'https://example.com/broken.xml'
  );
  const healthy = subscription(
    'alice',
    feedId('i'),
    'https://example.com/healthy.xml'
  );
  const updated: Array<string> = [];
  const done = Deferred.makeUnsafe<void>();

  return Effect.gen(function* () {
    yield* Deferred.await(done);
    expect(updated).toEqual([healthy.id]);
  }).pipe(
    Effect.provide(
      scheduler({
        schedules: [schedule('alice', '30 minutes')],
        subscriptions: {
          list: ownedBy([broken, healthy]),
          find: findById([broken, healthy]),
          update: (_ownerId, updates) =>
            Effect.gen(function* () {
              updated.push(...updates.map((update) => update.id));
              yield* Deferred.succeed(done, undefined);
            }),
        },
        http: (url) =>
          Effect.succeed(
            url.href === broken.url.href
              ? new Response('no', { status: 503 })
              : document()
          ),
        items: {
          inventory: () => Effect.succeed([]),
          retain: () => Effect.void,
        },
      })
    )
  );
});

it.effect('skips a subscription removed before it refreshes', () => {
  const removed = subscription(
    'alice',
    feedId('j'),
    'https://example.com/removed.xml'
  );
  const present = subscription(
    'bob',
    feedId('k'),
    'https://example.com/present.xml'
  );
  const fetched: Array<string> = [];
  const done = Deferred.makeUnsafe<void>();

  return Effect.gen(function* () {
    yield* Deferred.await(done);
    yield* Effect.yieldNow;
    expect(fetched).toEqual([present.url.href]);
  }).pipe(
    Effect.provide(
      scheduler({
        schedules: [
          schedule('alice', '30 minutes'),
          schedule('bob', '30 minutes'),
        ],
        subscriptions: {
          list: ownedBy([removed, present]),
          find: findById([present]),
          update: () => Effect.void,
        },
        http: (url) =>
          Effect.gen(function* () {
            fetched.push(url.href);
            yield* Deferred.succeed(done, undefined);

            return document();
          }),
        items: {
          inventory: () => Effect.succeed([]),
          retain: () => Effect.void,
        },
      })
    )
  );
});

it.effect('reconciles owners that are added or removed', () => {
  const alice = subscription(
    'alice',
    feedId('l'),
    'https://example.com/alice-cleanup.xml'
  );
  const bob = subscription(
    'bob',
    feedId('m'),
    'https://example.com/bob-added.xml'
  );
  let current = [schedule('alice', '30 minutes')];
  const fetched: Array<string> = [];
  const aliceFirst = Deferred.makeUnsafe<void>();
  const bobFirst = Deferred.makeUnsafe<void>();

  return Effect.gen(function* () {
    yield* Deferred.await(aliceFirst);
    expect(fetched).toEqual([alice.url.href]);

    current = [schedule('alice', '30 minutes'), schedule('bob', '30 minutes')];
    yield* TestClock.adjust('1 minute');
    yield* Deferred.await(bobFirst);

    current = [schedule('bob', '30 minutes')];
    yield* TestClock.adjust('1 minute');
    yield* TestClock.adjust('30 minutes');

    expect(fetched.filter((href) => href === alice.url.href)).toHaveLength(1);
    expect(fetched.filter((href) => href === bob.url.href)).toHaveLength(2);
  }).pipe(
    Effect.provide(
      scheduler({
        schedules: () => current,
        subscriptions: {
          list: ownedBy([alice, bob]),
          find: findById([alice, bob]),
          update: () => Effect.void,
        },
        http: (url) =>
          Effect.gen(function* () {
            fetched.push(url.href);
            if (url.href === alice.url.href) {
              yield* Deferred.succeed(aliceFirst, undefined);
            }

            if (url.href === bob.url.href) {
              yield* Deferred.succeed(bobFirst, undefined);
            }

            return document();
          }),
        items: {
          inventory: () => Effect.succeed([]),
          retain: () => Effect.void,
        },
      })
    )
  );
});

it.effect(
  'refreshes three owners concurrently with three workers',
  () => {
    const items = [
      subscription('alice', feedId('1'), 'https://example.com/1.xml'),
      subscription('bob', feedId('2'), 'https://example.com/2.xml'),
      subscription('carol', feedId('3'), 'https://example.com/3.xml'),
    ];
    let started = 0;
    let updated = 0;
    const barrier = Deferred.makeUnsafe<void>();
    const done = Deferred.makeUnsafe<void>();

    return Effect.gen(function* () {
      yield* Deferred.await(done);
      expect(updated).toBe(items.length);
    }).pipe(
      Effect.provide(
        scheduler({
          schedules: items.map((item) => schedule(item.ownerId, '30 minutes')),
          subscriptions: {
            list: ownedBy(items),
            find: findById(items),
            update: () =>
              Effect.gen(function* () {
                updated += 1;
                if (updated === items.length) {
                  yield* Deferred.succeed(done, undefined);
                }
              }),
          },
          http: () =>
            Effect.gen(function* () {
              started += 1;
              if (started === items.length) {
                yield* Deferred.succeed(barrier, undefined);
              }

              yield* Deferred.await(barrier);

              return document();
            }),
          items: {
            inventory: () => Effect.succeed([]),
            retain: () => Effect.void,
          },
        })
      )
    );
  },
  5000
);
