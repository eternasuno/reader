// biome-ignore-all lint/style/noExcessiveLinesPerFile: scheduler tests share feed fixtures and mock layer assembly.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its mocks alongside the asserted scenario.
import { expect, it } from '@effect/vitest';
import {
  type Context,
  DateTime,
  Deferred,
  Effect,
  Layer,
  Option,
} from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { TestClock } from 'effect/testing';
import type { Feed } from '../../../../packages/business/src/entity/feed.ts';
import {
  FeedId,
  OwnerId,
} from '../../../../packages/business/src/entity/object-value.ts';
import { ArticleRepository } from '../../../../packages/business/src/port/article-repository.ts';
import { DocumentSantize } from '../../../../packages/business/src/port/document-santize.ts';
import { FeedParser } from '../../../../packages/business/src/port/feed-parser.ts';
import { FeedRepository } from '../../../../packages/business/src/port/feed-repository.ts';
import { SettingsRepository } from '../../../../packages/business/src/port/settings-repository.ts';
import { HtmlParserLive } from '../../src/adapter/html-parser';
import { SubscriptionSchedulerLive } from '../../src/infrastructure/subscription-scheduler';

type Mocks = {
  readonly subscriptions?: Partial<
    Context.Service.Shape<typeof FeedRepository>
  >;
  readonly http?: (url: URL) => Effect.Effect<Response>;
  readonly parser?: Partial<Context.Service.Shape<typeof FeedParser>>;
  readonly articles?: Partial<Context.Service.Shape<typeof ArticleRepository>>;
  readonly processor?: Partial<Context.Service.Shape<typeof DocumentSantize>>;
};

const feedId = (seed: string) => FeedId.make(seed.repeat(64).slice(0, 64));

const subscription = (owner: string, id: FeedId, url: string): Feed => ({
  id,
  ownerId: OwnerId.make(owner),
  url: new URL(url),
  title: url,
  updatedAt: DateTime.fromDateUnsafe(new Date('2026-01-01T00:00:00.000Z')),
});

const feed = { title: 'Feed', description: Option.none(), articles: [] };

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

const scheduler = (mocks: Mocks) =>
  SubscriptionSchedulerLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(FeedRepository, mocks.subscriptions ?? {}),
        Layer.mock(SettingsRepository, {
          get: () =>
            Effect.succeed({
              retention: 100,
              provider: 'jina',
              jinaConfigured: false,
              browserEndpoint: Option.none(),
            }),
        }),
        httpClient(mocks.http ?? (() => Effect.succeed(document()))),
        Layer.mock(FeedParser, {
          parse: () => Effect.succeed(feed),
          ...mocks.parser,
        }),
        Layer.mock(ArticleRepository, mocks.articles ?? {}),
        Layer.mock(DocumentSantize, {
          sanitize: () => Effect.succeed(''),
          ...mocks.processor,
        }),
        HtmlParserLive
      )
    )
  );

const findById = (items: readonly Feed[]) => (_owner: OwnerId, id: FeedId) =>
  Effect.succeed(Option.fromNullishOr(items.find((item) => item.id === id)));

it.effect('refreshes every subscription immediately on startup', () => {
  const items = [
    subscription('alice', feedId('a'), 'https://example.com/a.xml'),
    subscription('bob', feedId('b'), 'https://example.com/b.xml'),
  ];
  const fetched: string[] = [];
  const done = Deferred.makeUnsafe<void>();

  return Effect.gen(function* () {
    yield* Deferred.await(done);
    expect([...fetched].sort()).toEqual(
      items.map((item) => item.url.href).sort()
    );
  }).pipe(
    Effect.provide(
      scheduler({
        subscriptions: {
          list: () => Effect.succeed(items),
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
        articles: {
          inventory: () => Effect.succeed([]),
          retain: () => Effect.void,
        },
      })
    )
  );
});

it.effect('skips a subscription removed before execution', () => {
  const removed = subscription(
    'alice',
    feedId('c'),
    'https://example.com/removed.xml'
  );
  const present = subscription(
    'bob',
    feedId('d'),
    'https://example.com/present.xml'
  );
  const fetched: string[] = [];
  const done = Deferred.makeUnsafe<void>();

  return Effect.gen(function* () {
    yield* Deferred.await(done);
    yield* Effect.yieldNow;
    expect(fetched).toEqual([present.url.href]);
  }).pipe(
    Effect.provide(
      scheduler({
        subscriptions: {
          list: () => Effect.succeed([removed, present]),
          find: findById([present]),
          update: () => Effect.void,
        },
        http: (url) =>
          Effect.gen(function* () {
            fetched.push(url.href);
            yield* Deferred.succeed(done, undefined);

            return document();
          }),
        articles: {
          inventory: () => Effect.succeed([]),
          retain: () => Effect.void,
        },
      })
    )
  );
});

it.effect('does not enqueue a feed while its refresh is still running', () => {
  const item = subscription('alice', feedId('e'), 'https://example.com/e.xml');
  let scans = 0;
  let fetches = 0;
  let updates = 0;
  const started = Deferred.makeUnsafe<void>();
  const gate = Deferred.makeUnsafe<void>();
  const nextScan = Deferred.makeUnsafe<void>();
  const finished = Deferred.makeUnsafe<void>();

  return Effect.gen(function* () {
    yield* Deferred.await(started);
    yield* TestClock.adjust('30 minutes');
    yield* Deferred.await(nextScan);
    expect(fetches).toBe(1);

    yield* Deferred.succeed(gate, undefined);
    yield* Deferred.await(finished);
    expect(fetches).toBe(1);
    expect(updates).toBe(1);
  }).pipe(
    Effect.provide(
      scheduler({
        subscriptions: {
          list: () =>
            Effect.gen(function* () {
              scans += 1;
              if (scans === 2) {
                yield* Deferred.succeed(nextScan, undefined);
              }

              return [item];
            }),
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
        articles: {
          inventory: () => Effect.succeed([]),
          retain: () => Effect.void,
        },
      })
    )
  );
});

it.effect('logs a failed refresh and retries on the next scan', () => {
  const item = subscription('alice', feedId('f'), 'https://example.com/f.xml');
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
        subscriptions: {
          list: () => Effect.succeed([item]),
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
        articles: {
          inventory: () => Effect.succeed([]),
          retain: () => Effect.void,
        },
      })
    )
  );
});

it.effect(
  'processes refreshes with three concurrent workers',
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
          subscriptions: {
            list: () => Effect.succeed(items),
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
          articles: {
            inventory: () => Effect.succeed([]),
            retain: () => Effect.void,
          },
        })
      )
    );
  },
  5000
);
