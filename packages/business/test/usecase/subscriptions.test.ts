// biome-ignore-all lint/style/noExcessiveLinesPerFile: subscription workflow tests share one set of feed and store fixtures.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its mocks alongside the asserted scenario.
import { expect, it } from '@effect/vitest';
import { type Context, DateTime, Effect, Layer, Option, Schema } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { TestClock } from 'effect/testing';
import { type Article, ArticleId } from '../../src/entity/article';
import type { Feed } from '../../src/entity/feed';
import { OwnerId } from '../../src/entity/object-value';
import {
  type ArticleBoundary,
  ArticleRepository,
  ArticleRepositoryError,
} from '../../src/port/article-repository';
import { DocumentSantize } from '../../src/port/document-santize';
import {
  FeedParser,
  FeedParserError,
  type ParsedArticle,
  type ParsedFeed,
} from '../../src/port/feed-parser';
import {
  FeedRepository,
  type FeedUpdate,
} from '../../src/port/feed-repository';
import { HtmlParser } from '../../src/port/html-parser';
import { SettingsRepository } from '../../src/port/settings-repository';
import { articleId, feedId, normalizeUrl } from '../../src/usecase/identity';
import {
  refreshSubscription,
  subscribe,
} from '../../src/usecase/subscriptions';

const alice = OwnerId.make('alice');
const url = normalizeUrl('https://example.com/feed.xml');
const id = feedId(alice, url);
const nowMillis = Date.UTC(2026, 0, 1, 12);

const at = (iso: string) => DateTime.fromDateUnsafe(new Date(iso));

// The processing services are mocked here, so the parser only needs the body
// that the processor mock reads back.
const parsedDocument = (html: string) =>
  ({ URL: 'about:blank', body: { innerHTML: html } }) as Document;

const encoded = (value: DateTime.Utc) =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(value);

const entry = (overrides: Partial<ParsedArticle> = {}): ParsedArticle => ({
  title: 'One',
  url: Option.some(new URL('https://example.com/one')),
  description: Option.none(),
  content: Option.none(),
  publishedAt: at('2026-01-01T12:00:00.000Z'),
  ...overrides,
});

const feed = (
  articles: readonly ParsedArticle[],
  title = 'News'
): ParsedFeed => ({ title, url, description: Option.none(), articles });

const subscription = (): Feed => ({
  id,
  ownerId: alice,
  url,
  title: 'Old',
  updatedAt: at('2025-12-01T00:00:00.000Z'),
});

const feedBody = '<rss/>';

const feedResponse = () =>
  Effect.succeed(new Response(feedBody, { status: 200 }));

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

const settingsValue = (retention: number) => ({
  retention,
  provider: 'jina' as const,
  jinaKey: Option.none(),
  browserEndpoint: Option.none<string>(),
});

const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layers: {
    readonly http?: (url: URL) => Effect.Effect<Response>;
    readonly feedParser?: Partial<Context.Service.Shape<typeof FeedParser>>;
    readonly parser?: Partial<Context.Service.Shape<typeof HtmlParser>>;
    readonly processor?: Partial<Context.Service.Shape<typeof DocumentSantize>>;
    readonly articles?: Partial<
      Context.Service.Shape<typeof ArticleRepository>
    >;
    readonly subscriptions?: Partial<
      Context.Service.Shape<typeof FeedRepository>
    >;
    readonly settings?: Partial<
      Context.Service.Shape<typeof SettingsRepository>
    >;
  }
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        httpClient(layers.http ?? feedResponse),
        Layer.mock(FeedParser, {
          parse: () => Effect.succeed(feed([])),
          ...layers.feedParser,
        }),
        Layer.mock(HtmlParser, {
          parse: (html) => Effect.succeed(parsedDocument(html)),
          ...layers.parser,
        }),
        Layer.mock(DocumentSantize, {
          sanitize: (document) => Effect.succeed(document.body.innerHTML),
          ...layers.processor,
        }),
        Layer.mock(ArticleRepository, layers.articles ?? {}),
        Layer.mock(FeedRepository, layers.subscriptions ?? {}),
        Layer.mock(SettingsRepository, {
          get: () => Effect.succeed(settingsValue(100)),
          ...layers.settings,
        })
      )
    )
  );

it.effect('rejects a non-HTTP subscription URL before fetching', () => {
  let fetched = false;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        subscribe(alice, 'ftp://example.com/feed')
      );
      expect(error._tag).toBe('SubscriptionUrlInvalid');
      expect(error.message).toBe('Subscription URL must use HTTP or HTTPS');
      expect(fetched).toBe(false);
    }),
    {
      http: () => {
        fetched = true;

        return feedResponse();
      },
    }
  );
});

it.effect('parses the fetched document against its final URL', () => {
  const finalUrl = new URL('https://final.example/feed.xml');
  const calls: string[] = [];

  return provide(
    Effect.gen(function* () {
      yield* refreshSubscription(alice, id);
      expect(calls).toEqual([
        `fetch ${url.href}`,
        `fetch ${finalUrl.href}`,
        `parse <rss/> ${finalUrl.href}`,
      ]);
    }),
    {
      settings: {
        get: () => Effect.succeed(settingsValue(100)),
      },
      subscriptions: {
        find: () => Effect.succeed(Option.some(subscription())),
        update: () => Effect.void,
      },
      http: (requested) => {
        calls.push(`fetch ${requested.href}`);

        return Effect.succeed(
          requested.href === url.href
            ? new Response(null, {
                status: 302,
                headers: { location: finalUrl.href },
              })
            : new Response(feedBody, { status: 200 })
        );
      },
      feedParser: {
        parse: (content, sourceUrl) => {
          calls.push(`parse ${content} ${sourceUrl.href}`);

          return Effect.succeed(feed([]));
        },
      },
      articles: {
        inventory: () => Effect.succeed([]),
        retain: () => Effect.void,
      },
    }
  );
});

it.effect('reports a feed fetch failure without parsing the document', () => {
  let parsed = false;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(refreshSubscription(alice, id));
      expect(error).toMatchObject({
        _tag: 'FetchSubscriptionError',
        message: 'Failed to fetch the subscription feed',
      });
      expect(parsed).toBe(false);
    }),
    {
      subscriptions: {
        find: () => Effect.succeed(Option.some(subscription())),
      },
      http: () => Effect.succeed(new Response('no', { status: 503 })),
      feedParser: {
        parse: () => {
          parsed = true;

          return Effect.succeed(feed([]));
        },
      },
    }
  );
});

it.effect('reports an invalid redirect as a feed fetch failure', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(refreshSubscription(alice, id));
      expect(error).toMatchObject({
        _tag: 'FetchSubscriptionError',
        message: 'Failed to fetch the subscription feed',
      });
    }),
    {
      subscriptions: {
        find: () => Effect.succeed(Option.some(subscription())),
      },
      http: () =>
        Effect.succeed(
          new Response(null, {
            status: 302,
            headers: { location: 'http://[invalid' },
          })
        ),
    }
  )
);

it.effect('reports a feed parse failure', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(refreshSubscription(alice, id));
      expect(error).toMatchObject({
        _tag: 'FeedParserError',
        message: 'Failed to parse the subscription feed',
      });
    }),
    {
      subscriptions: {
        find: () => Effect.succeed(Option.some(subscription())),
      },
      feedParser: {
        parse: () =>
          Effect.fail(
            new FeedParserError({
              message: 'Failed to parse the subscription feed',
            })
          ),
      },
    }
  )
);

it.effect(
  'creates the subscription before importing the newest distinct articles',
  () => {
    const events: string[] = [];
    const created: (readonly Article[])[] = [];
    const processed: string[] = [];
    const newest = entry({
      title: 'Newest',
      url: Option.some(new URL('https://example.com/newest')),
      description: Option.some('Plain summary'),
      content: Option.some('<p>Body</p>'),
      publishedAt: at('2026-01-02T00:00:00.000Z'),
    });
    const older = entry({
      title: 'Older',
      url: Option.some(new URL('https://example.com/older')),
      content: Option.some('plain body'),
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const undated = entry({
      title: 'Undated',
      url: Option.some(new URL('https://example.com/undated')),
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
          'Plain summary',
          '<p>Body</p>',
          'plain body',
        ]);
        const items = created[0] ?? [];
        expect(items.map((item) => item.title)).toEqual([
          'Newest',
          'Undated',
          'Older',
        ]);
        expect(items[0]).toMatchObject({
          description: Option.some('Plain summary'),
          content: Option.some('<p>Body</p>'),
          feedId: Option.some(id),
          read: false,
        });
        expect(items[0]?.id).toBe(
          articleId(
            alice,
            id,
            Option.getOrUndefined(newest.url),
            newest.title,
            Option.getOrUndefined(newest.description)
          )
        );
        expect(
          encoded(items[0]?.publishedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-02T00:00:00.000Z');
        expect(items[2]).toMatchObject({ content: Option.some('plain body') });
        expect(
          encoded(items[1]?.publishedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-01T12:00:00.000Z');
      }),
      {
        feedParser: {
          parse: () =>
            Effect.succeed(feed([older, undated, newest, { ...newest }])),
        },
        subscriptions: {
          find: () => Effect.succeed(Option.none()),
          create: (owner, items) => {
            events.push('subscription');
            expect(owner).toBe(alice);
            stored = items[0];

            return Effect.succeed(items.map((item) => item.id));
          },
        },
        parser: {
          parse: (html) => {
            processed.push(html);

            return Effect.succeed(parsedDocument(html));
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
    url: Option.none(),
    content: Option.some('plain body'),
  });

  return provide(
    Effect.gen(function* () {
      yield* subscribe(alice, url.href);
      const items = created[0] ?? [];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'No URL',
        content: Option.some('plain body'),
        feedId: Option.some(id),
      });
      expect(items[0]?.url).toEqual(Option.none());
      expect(items[0]?.id).toBe(
        articleId(alice, id, undefined, 'No URL', undefined)
      );
    }),
    {
      feedParser: { parse: () => Effect.succeed(feed([linkless])) },
      subscriptions: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed([id]),
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

it.effect('truncates feed content before parsing it', () => {
  const parsed: string[] = [];
  const long = entry({ content: Option.some('a'.repeat(100_500)) });

  return provide(
    Effect.gen(function* () {
      yield* subscribe(alice, url.href);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveLength(100_000);
    }),
    {
      feedParser: { parse: () => Effect.succeed(feed([long])) },
      subscriptions: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed([id]),
      },
      parser: {
        parse: (html) => {
          parsed.push(html);

          return Effect.succeed(parsedDocument(html));
        },
      },
      articles: {
        create: (_owner, items) => Effect.succeed(items.map((item) => item.id)),
      },
    }
  );
});

it.effect('imports at most 30 articles from a large feed', () => {
  const created: (readonly Article[])[] = [];
  const entries = Array.from({ length: 35 }, (_, index) =>
    entry({
      title: `Article ${index}`,
      url: Option.some(new URL(`https://example.com/${index}`)),
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
      feedParser: { parse: () => Effect.succeed(feed(entries)) },
      subscriptions: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed([id]),
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
      http: () => {
        fetched = true;

        return feedResponse();
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
        create: () => Effect.succeed([]),
      },
      feedParser: { parse: () => Effect.succeed(feed([])) },
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
        create: () => Effect.succeed([id]),
      },
      feedParser: { parse: () => Effect.succeed(feed([entry()])) },
      articles: {
        create: () =>
          Effect.fail(new ArticleRepositoryError({ message: 'write failed' })),
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
      http: () => {
        fetched = true;

        return feedResponse();
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
      url: Option.some(new URL('https://example.com/tied')),
      content: Option.some('<p>Tied body</p>'),
      publishedAt: at('2026-01-02T00:00:00.000Z'),
    });
    const known = entry({ title: 'Known', url: Option.some(knownUrl) });
    const inventory: ArticleBoundary[] = [
      {
        id: ArticleId.make('b'.repeat(64)),
        publishedAt: '2026-01-02T00:00:00.000Z',
      },
      { id: knownId, publishedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const patches: FeedUpdate[] = [];
    let patchedOwner: string | undefined;

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        const result = yield* refreshSubscription(alice, id);
        expect(events).toEqual(['articles', 'retain', 'update']);
        expect(created[0]?.map((item) => item.title)).toEqual(['Tied']);
        expect(retained[0]).toEqual([
          ArticleId.make('b'.repeat(64)),
          articleId(
            alice,
            id,
            Option.getOrUndefined(tied.url),
            tied.title,
            Option.getOrUndefined(tied.description)
          ),
          knownId,
        ]);
        expect(processed).toEqual(['<p>Tied body</p>']);
        expect(patchedOwner).toBe(alice);
        expect(patches).toEqual([
          {
            id,
            feedPatch: {
              title: 'Updated',
              updatedAt: at('2026-01-01T12:00:00.000Z'),
            },
          },
        ]);
        expect(result.item).toMatchObject({ id, url, title: 'Updated' });
        expect(
          encoded(result.item.updatedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-01T12:00:00.000Z');
      }),
      {
        settings: {
          get: () => Effect.succeed(settingsValue(100)),
        },
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
          update: (owner, items) =>
            Effect.sync(() => {
              events.push('update');
              patchedOwner = owner;
              patches.push(...items);
            }),
        },
        feedParser: {
          parse: () => Effect.succeed(feed([tied, known], 'Updated')),
        },
        processor: {
          sanitize: (document) => {
            processed.push(document.body.innerHTML);

            return Effect.succeed(document.body.innerHTML);
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
      settings: {
        get: () => Effect.succeed(settingsValue(50)),
      },
      subscriptions: {
        find: () => Effect.succeed(Option.some(subscription())),
        update: () => Effect.void,
      },
      feedParser: {
        parse: () =>
          Effect.succeed(
            feed([entry({ publishedAt: at('2026-01-01T00:00:00.000Z') })])
          ),
      },
      processor: {
        sanitize: () => {
          processed = true;

          return Effect.succeed('');
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
      url: Option.some(repeated),
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const newest = entry({
      title: 'Repeated',
      url: Option.some(repeated),
      publishedAt: at('2026-01-05T00:00:00.000Z'),
    });
    const newestId = articleId(
      alice,
      id,
      repeated,
      newest.title,
      Option.getOrUndefined(newest.description)
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
        settings: {
          get: () => Effect.succeed(settingsValue(100)),
        },
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
          update: () => Effect.void,
        },
        feedParser: {
          parse: () => Effect.succeed(feed([stale, newest])),
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
      url: Option.some(repeated),
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const fresh = entry({
      title: 'Fresh',
      url: Option.some(new URL('https://example.com/fresh')),
      publishedAt: at('2026-01-15T00:00:00.000Z'),
    });
    const newest = entry({
      title: 'Repeated',
      url: Option.some(repeated),
      publishedAt: at('2026-01-20T00:00:00.000Z'),
    });
    const newestId = articleId(
      alice,
      id,
      repeated,
      newest.title,
      Option.getOrUndefined(newest.description)
    );
    const freshId = articleId(
      alice,
      id,
      Option.getOrUndefined(fresh.url),
      fresh.title,
      undefined
    );
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
        settings: {
          get: () => Effect.succeed(settingsValue(2)),
        },
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
          update: () => Effect.void,
        },
        feedParser: {
          parse: () => Effect.succeed(feed([stale, fresh, newest])),
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
        settings: {
          get: () => Effect.succeed(settingsValue(100)),
        },
        subscriptions: {
          find: () => Effect.succeed(Option.some(subscription())),
        },
        feedParser: { parse: () => Effect.succeed(feed([])) },
        articles: {
          inventory: () => Effect.succeed([]),
          retain: () =>
            Effect.fail(
              new ArticleRepositoryError({ message: 'retain failed' })
            ),
        },
      }
    )
);
