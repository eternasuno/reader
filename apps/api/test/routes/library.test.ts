// biome-ignore-all lint/style/noExcessiveLinesPerFile: one integration scenario exercises the library API boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: the scenario follows the user journey in order.
import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  ArticleDescription,
  ArticleExtractor,
  ArticleRepository,
  ArticleRepositoryError,
  ArticleTitle,
  DocumentSantize,
  DocumentSantizeError,
  FeedParser,
  HtmlParser,
  HtmlParserError,
  NormalizedUrl,
  OptionFromOptionalNonEmpty,
  SettingsRepository,
  SettingsRepositoryError,
} from '@reader/business';
import { BrowserConcurrencyLive } from '@reader/webpage';
import { surrealAdapter } from '@surrealdb/better-auth';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { DateTime, Effect, Layer, Option, Schema } from 'effect';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
} from 'effect/http';
import type { Surreal } from 'surrealdb';
import { vi } from 'vitest';
import {
  ArticleItemSchema,
  ArticlePageSchema,
  UnreadCountsSchema,
} from '../../../web/src/lib/library-schema.ts';
import { makeArticles } from '../../src/adapter/article-store';
import { FeedFetcherLive } from '../../src/adapter/feed-fetcher';
import { HtmlParserLive } from '../../src/adapter/html-parser';
import {
  ArticleRepositoryLive,
  FeedRepositoryLive,
  ReaderStoreConcurrency,
  ReaderStoreConcurrencyLive,
  readerStoreSchema,
} from '../../src/adapter/reader-store';
import { SettingsRepositoryLive } from '../../src/adapter/settings-repository';
import { AppLive } from '../../src/app';
import { Auth } from '../../src/infrastructure/auth';
import { createSurreal, Database } from '../../src/infrastructure/db';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

const origin = 'http://localhost:3000';

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2026-01-01T00:00:00.000Z')
);

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const decodeContent = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

const decodeDescription = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleDescription)
);

type Handler = (request: Request) => Promise<Response>;

const signIn = async (handler: Handler, email: string): Promise<string> => {
  const post = (path: string) =>
    handler(
      new Request(`${origin}/api/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({
          name: 'Reader',
          email,
          password: 'test-password-123',
        }),
      })
    );
  expect((await post('sign-up/email')).status).toBe(200);
  const response = await post('sign-in/email');
  expect(response.status).toBe(200);

  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
};

const call = (
  handler: Handler,
  method: string,
  path: string,
  cookie?: string,
  body?: object,
  requestOrigin = origin
) =>
  handler(
    new Request(`${origin}${path}`, {
      method,
      headers: {
        ...(cookie === undefined ? {} : { cookie }),
        origin: requestOrigin,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  );

const json = async <A>(response: Response): Promise<A> =>
  (await response.json()) as A;

const readCounts = async (handler: Handler, cookie?: string) => {
  const response = await call(handler, 'GET', '/api/library/unread', cookie);
  expect(response.status).toBe(200);

  return Schema.decodeUnknownPromise(UnreadCountsSchema)(await json(response));
};

type FeedItem = { readonly id: string; readonly title: string };

type ArticleItem = {
  readonly id: string;
  readonly title: string;
  readonly read: boolean;
  readonly extractedContent?: string;
};

type Page = {
  readonly items: ReadonlyArray<ArticleItem>;
  readonly cursor: string | null;
  readonly boundary: string | null;
};

const verifyAuthAndPreview = async (handler: Handler, alice: string) => {
  expect((await call(handler, 'GET', '/api/library/later')).status).toBe(401);
  expect(
    (
      await call(handler, 'POST', '/api/library/feeds/preview', undefined, {
        url: 'https://example.com/feed.xml',
      })
    ).status
  ).toBe(401);
  expect(
    (
      await call(
        handler,
        'POST',
        '/api/library/feeds/preview',
        alice,
        { url: 'https://example.com/feed.xml' },
        'https://untrusted.example'
      )
    ).status
  ).toBe(403);

  const preview = await json<{
    preview: {
      url: string;
      title: string;
      description?: string;
      titles: ReadonlyArray<string>;
    };
  }>(
    await call(handler, 'POST', '/api/library/feeds/preview', alice, {
      url: ' https://example.com/feed.xml?utm_source=x ',
    })
  );
  expect(preview).toEqual({
    preview: {
      url: 'https://example.com/feed.xml',
      title: 'Example feed',
      description: 'Daily updates',
      titles: ['One', 'Two', 'Three', 'Four'],
    },
  });
  expect(
    (
      await call(handler, 'POST', '/api/library/feeds/preview', alice, {
        url: 'ftp://example.com/feed.xml',
      })
    ).status
  ).toBe(400);
};

const subscribe = async (handler: Handler, alice: string) => {
  const subscribed = await call(handler, 'POST', '/api/library/feeds', alice, {
    url: 'https://example.com/feed.xml',
  });
  expect(subscribed.status).toBe(200);
  const { item } = await json<{ item: FeedItem }>(subscribed);
  expect(item.title).toBe('Example feed');

  const duplicate = await call(handler, 'POST', '/api/library/feeds', alice, {
    url: 'https://example.com/feed.xml',
  });
  expect(duplicate.status).toBe(409);
  expect(await json(duplicate)).toMatchObject({
    _tag: 'FeedExists',
    message: 'Feed already exists',
    id: item.id,
  });

  return item;
};

const verifyArticles = async (
  handler: Handler,
  alice: string,
  bob: string,
  feedId: string
) => {
  const feeds = await json<{ items: ReadonlyArray<FeedItem> }>(
    await call(handler, 'GET', '/api/library/feeds', alice)
  );
  expect(feeds.items.map(({ id }) => id)).toEqual([feedId]);
  expect(
    await json(await call(handler, 'GET', '/api/library/feeds', bob))
  ).toEqual({ items: [] });

  expect(await readCounts(handler, alice)).toEqual({
    later: 0,
    feedsTotal: 4,
    feeds: [{ id: feedId, count: 4 }],
  });
  expect(await readCounts(handler, bob)).toEqual({
    later: 0,
    feedsTotal: 0,
    feeds: [],
  });
  expect((await call(handler, 'GET', '/api/library/unread')).status).toBe(401);

  const feedPageText = await (
    await call(
      handler,
      'GET',
      `/api/library/feeds/articles?feedId=${feedId}&filter=unread`,
      alice
    )
  ).text();
  expect(feedPageText).not.toContain('"description":null');
  expect(feedPageText).not.toContain('"content":null');
  expect(feedPageText).not.toContain('"extractedContent":null');
  const pagePayload = JSON.parse(feedPageText) as {
    readonly items: ReadonlyArray<object>;
  };
  const page =
    await Schema.decodeUnknownPromise(ArticlePageSchema)(pagePayload);
  expect(page.items.map(({ title }) => title).toSorted()).toEqual(
    ['One', 'Two', 'Three', 'Four'].toSorted()
  );
  expect(page.cursor).toBeNull();

  const first = page.items[0];
  if (first === undefined) {
    throw new Error('Missing seeded article');
  }

  const rawFirst =
    pagePayload.items[page.items.findIndex((item) => item.title === 'Two')];
  if (rawFirst === undefined) {
    throw new Error('Missing seeded article payload');
  }

  expect(Object.hasOwn(rawFirst, 'content')).toBe(false);
  expect(Object.hasOwn(rawFirst, 'extractedContent')).toBe(false);

  const saved = await call(
    handler,
    'POST',
    '/api/library/articles/save',
    alice,
    { id: first.id }
  );
  expect(saved.status).toBe(200);
  const { item: later } = await json<{ item: ArticleItem }>(saved);
  expect(await readCounts(handler, alice)).toEqual({
    later: 1,
    feedsTotal: 4,
    feeds: [{ id: feedId, count: 4 }],
  });

  expect(
    (
      await call(handler, 'PATCH', '/api/library/articles', alice, {
        id: first.id,
        read: true,
      })
    ).status
  ).toBe(200);
  expect(await readCounts(handler, alice)).toEqual({
    later: 1,
    feedsTotal: 3,
    feeds: [{ id: feedId, count: 3 }],
  });

  expect(
    await json<Page>(
      await call(handler, 'GET', '/api/library/later?filter=all', alice)
    )
  ).toMatchObject({ items: [{ id: later.id, read: false }], cursor: null });
  expect(
    await json<Page>(
      await call(handler, 'GET', '/api/library/later?filter=all', bob)
    )
  ).toEqual({ items: [], cursor: null, boundary: null });

  expect(
    (await call(handler, 'POST', '/api/library/mark-later', alice, {})).status
  ).toBe(200);
  expect(await readCounts(handler, alice)).toEqual({
    later: 0,
    feedsTotal: 3,
    feeds: [{ id: feedId, count: 3 }],
  });

  expect(
    (
      await call(handler, 'DELETE', '/api/library/articles', alice, {
        id: later.id,
      })
    ).status
  ).toBe(200);
  expect(
    await json<Page>(
      await call(handler, 'GET', '/api/library/later?filter=all', alice)
    )
  ).toEqual({ items: [], cursor: null, boundary: null });

  const urlLess = page.items.find(({ title }) => title === 'Four');
  if (urlLess === undefined) {
    throw new Error('Missing seeded URL-less article');
  }

  const savedUrlLess = await call(
    handler,
    'POST',
    '/api/library/articles/save',
    alice,
    { id: urlLess.id }
  );
  expect(savedUrlLess.status).toBe(200);
  const savedUrlLessText = await savedUrlLess.text();
  expect(savedUrlLessText).not.toContain('"feedId":null');
  expect(savedUrlLessText).not.toContain('"url":null');
  const urlLessPayload = JSON.parse(savedUrlLessText) as {
    readonly item: object;
  };
  expect(Object.hasOwn(urlLessPayload.item, 'feedId')).toBe(false);
  expect(Object.hasOwn(urlLessPayload.item, 'url')).toBe(false);
  const { item: urlLessLater } =
    await Schema.decodeUnknownPromise(ArticleItemSchema)(urlLessPayload);

  const laterPageText = await (
    await call(handler, 'GET', '/api/library/later?filter=all', alice)
  ).text();
  expect(laterPageText).not.toContain('"feedId":null');
  expect(laterPageText).not.toContain('"url":null');
  const laterPage = await Schema.decodeUnknownPromise(ArticlePageSchema)(
    JSON.parse(laterPageText)
  );
  expect(laterPage.items.map(({ id }) => id)).toEqual([urlLessLater.id]);

  expect(
    (
      await call(handler, 'DELETE', '/api/library/articles', alice, {
        id: urlLessLater.id,
      })
    ).status
  ).toBe(200);
};

const verifyAddedArticle = async (handler: Handler, alice: string) => {
  const added = await call(handler, 'POST', '/api/library/articles', alice, {
    url: 'https://example.com/manual',
  });
  expect(added.status).toBe(201);
  const { item } = await json<{ item: ArticleItem }>(added);
  expect(item.title).toBe('Example article');
  expect(item.extractedContent).toBe('<p>Body</p>');

  const fetched = await json<{ item: ArticleItem | null }>(
    await call(handler, 'GET', `/api/library/articles?id=${item.id}`, alice)
  );
  expect(fetched.item?.id).toBe(item.id);

  expect(
    (
      await call(handler, 'POST', '/api/library/articles/extract', alice, {
        id: item.id,
      })
    ).status
  ).toBe(200);
  expect(await readCounts(handler, alice)).toMatchObject({
    later: 1,
    feedsTotal: 3,
  });
};

const verifySettings = async (handler: Handler, alice: string) => {
  expect(
    await json(await call(handler, 'GET', '/api/library/settings', alice))
  ).toEqual({
    retention: 100,
    provider: 'jina',
    jinaConfigured: false,
  });

  expect(
    (
      await call(handler, 'PUT', '/api/library/settings/retention', alice, {
        retention: 120,
      })
    ).status
  ).toBe(200);
  expect(
    (
      await call(handler, 'PUT', '/api/library/settings/retention', alice, {
        retention: 10,
      })
    ).status
  ).toBe(400);
  expect(
    await json<{ _tag: string; message: string }>(
      await call(handler, 'PUT', '/api/library/settings/retention', alice, {
        retention: 10,
      })
    )
  ).toEqual({
    _tag: 'InvalidRetention',
    message: 'Retention must be an integer between 30 and 300',
  });

  expect(
    await json<{ _tag: string; message: string }>(
      await call(handler, 'PUT', '/api/library/settings/extraction', alice, {
        provider: 'other',
      })
    )
  ).toEqual({
    _tag: 'InvalidProvider',
    message: 'Choose a valid extraction provider',
  });
  expect(
    await json<{ _tag: string; message: string }>(
      await call(handler, 'PUT', '/api/library/settings/extraction', alice, {
        provider: 'jina',
        jinaKey: '   ',
      })
    )
  ).toEqual({
    _tag: 'InvalidKey',
    message: 'Enter a valid Jina API key',
  });
  expect(
    await json<{ _tag: string; message: string }>(
      await call(handler, 'PUT', '/api/library/settings/extraction', alice, {
        provider: 'browser',
      })
    )
  ).toEqual({
    _tag: 'InvalidEndpoint',
    message: 'Enter a valid browser service address',
  });

  expect(
    (
      await call(handler, 'PUT', '/api/library/settings/extraction', alice, {
        provider: 'browser',
        browserEndpoint: '  http://127.0.0.1:9222  ',
      })
    ).status
  ).toBe(200);
  expect(
    await json(await call(handler, 'GET', '/api/library/settings', alice))
  ).toEqual({
    retention: 120,
    provider: 'browser',
    jinaConfigured: false,
    browserEndpoint: 'http://127.0.0.1:9222/',
  });

  expect(
    (await call(handler, 'DELETE', '/api/library/settings/browser', alice))
      .status
  ).toBe(200);
  expect(
    (await call(handler, 'DELETE', '/api/library/settings/key', alice)).status
  ).toBe(200);
  expect(
    await json(await call(handler, 'GET', '/api/library/settings', alice))
  ).toEqual({
    retention: 120,
    provider: 'jina',
    jinaConfigured: false,
  });
};

const verifyUnsubscribe = async (
  handler: Handler,
  alice: string,
  feedId: string
) => {
  expect(
    (
      await call(handler, 'DELETE', '/api/library/feeds', alice, {
        id: 'a'.repeat(64),
      })
    ).status
  ).toBe(404);
  expect(
    (await call(handler, 'DELETE', '/api/library/feeds', alice, { id: feedId }))
      .status
  ).toBe(200);
  expect(
    await json(await call(handler, 'GET', '/api/library/feeds', alice))
  ).toEqual({ items: [] });
  expect(await readCounts(handler, alice)).toEqual({
    later: 1,
    feedsTotal: 0,
    feeds: [],
  });
};

const verifyLibrary = async (handler: Handler) => {
  const alice = await signIn(handler, 'alice@example.com');
  const bob = await signIn(handler, 'bob@example.com');

  await verifyAuthAndPreview(handler, alice);
  const subscription = await subscribe(handler, alice);
  await verifyArticles(handler, alice, bob, subscription.id);
  await verifyAddedArticle(handler, alice);
  await verifySettings(handler, alice);
  await verifyUnsubscribe(handler, alice, subscription.id);
};

const feedSource = Layer.mergeAll(
  FeedFetcherLive.pipe(
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response('<rss/>', { status: 200 })
            )
          )
        )
      )
    )
  ),
  Layer.succeed(FeedParser, {
    parse: () =>
      Effect.succeed({
        title: 'Example feed',
        url: decodeUrl('https://example.com/feed.xml'),
        description: Option.some('Daily updates'),
        articles: [
          {
            title: Schema.decodeSync(ArticleTitle)('One'),
            url: Option.some(decodeUrl('https://example.com/one')),
            description: decodeDescription(undefined),
            content: decodeContent('<p>One</p>'),
            publishedAt,
          },
          {
            title: Schema.decodeSync(ArticleTitle)('Two'),
            url: Option.some(decodeUrl('https://example.com/two')),
            description: decodeDescription(undefined),
            content: decodeContent(undefined),
            publishedAt,
          },
          {
            title: Schema.decodeSync(ArticleTitle)('Three'),
            url: Option.some(decodeUrl('https://example.com/three')),
            description: decodeDescription(undefined),
            content: decodeContent(undefined),
            publishedAt,
          },
          {
            title: Schema.decodeSync(ArticleTitle)('Four'),
            url: Option.none(),
            description: decodeDescription(undefined),
            content: decodeContent(undefined),
            publishedAt,
          },
        ],
      }),
  })
);

const articleExtractor = Layer.succeed(ArticleExtractor, {
  extract: () =>
    Effect.succeed({
      title: Schema.decodeSync(ArticleTitle)('Example article'),
      description: decodeDescription(undefined),
      content: decodeContent('<p>Body</p>'),
      publishedAt,
    }),
});

const authOptions = (db: Surreal) => ({
  baseURL: origin,
  secret: 'test-only-secret-at-least-32-characters',
  emailAndPassword: { enabled: true, autoSignIn: false },
  database: surrealAdapter({ db }),
});

const openDatabase = (namespace: string) =>
  Effect.promise(() =>
    createSurreal({ endpoint: 'mem://', namespace, database: 'test' })
  );

const setupDatabase = async (db: Surreal) => {
  const options = authOptions(db);
  const schema = await options.database(options).createSchema?.(options);
  if (schema?.code) {
    await db.query(schema.code);
  }

  await db.query(readerStoreSchema);

  return options;
};

type ArticleStore = Layer.Layer<
  ArticleRepository,
  never,
  Database | ReaderStoreConcurrency
>;

const failingCounts = (
  db: Surreal
): Layer.Layer<ArticleRepository, never, ReaderStoreConcurrency> =>
  Layer.effect(
    ArticleRepository,
    Effect.gen(function* () {
      const lock = yield* ReaderStoreConcurrency;
      const articles = makeArticles(db, lock);

      return {
        ...articles,
        unreadCounts: () =>
          Effect.fail(
            new ArticleRepositoryError({ message: 'Unread count failed' })
          ),
      };
    })
  );

const makeHandler = (
  db: Surreal,
  options: ReturnType<typeof authOptions>,
  articles: ArticleStore,
  overrides: {
    readonly parser?: Layer.Layer<HtmlParser>;
    readonly sanitizer?: Layer.Layer<DocumentSantize>;
    readonly settings?: Layer.Layer<SettingsRepository>;
  } = {}
) => {
  const services = Layer.mergeAll(
    articles,
    FeedRepositoryLive,
    overrides.settings ?? SettingsRepositoryLive,
    feedSource,
    overrides.sanitizer ??
      Layer.succeed(DocumentSantize, {
        sanitize: () => Effect.succeed(decodeContent('<p>Body</p>')),
      }),
    BrowserConcurrencyLive,
    Layer.succeed(FetchHttpClient.Fetch, () =>
      Promise.resolve(new Response('<html><body><p>Body</p></body></html>'))
    ),
    articleExtractor,
    overrides.parser ?? HtmlParserLive
  ).pipe(
    Layer.provide(
      Layer.mergeAll(Layer.succeed(Database, db), ReaderStoreConcurrencyLive)
    )
  );
  const routes = AppLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Auth, betterAuth<BetterAuthOptions>(options)),
        services
      )
    )
  );

  return HttpRouter.toWebHandler(routes, { disableLogger: true });
};

it.effect('serves authenticated owner-scoped library operations', () =>
  Effect.acquireUseRelease(
    openDatabase('route-library'),
    (db) =>
      Effect.promise(async () => {
        const options = await setupDatabase(db);
        const { handler, dispose } = makeHandler(
          db,
          options,
          ArticleRepositoryLive
        );
        try {
          await verifyLibrary(handler);
        } finally {
          await dispose();
        }
      }),
    (db) => Effect.promise(() => db.close())
  )
);

it.effect('reports repository failures for the unified unread counts', () =>
  Effect.acquireUseRelease(
    openDatabase('route-unread'),
    (db) =>
      Effect.promise(async () => {
        const options = await setupDatabase(db);
        const unreadFails = makeHandler(db, options, failingCounts(db));
        try {
          const alice = await signIn(unreadFails.handler, 'alice@example.com');
          const subscribed = await call(
            unreadFails.handler,
            'POST',
            '/api/library/feeds',
            alice,
            { url: 'https://example.com/feed.xml' }
          );
          expect(subscribed.status).toBe(200);
          const { item } = await json<{ item: FeedItem }>(subscribed);
          expect(
            (
              await call(
                unreadFails.handler,
                'POST',
                '/api/library/articles',
                alice,
                { url: 'https://example.com/manual' }
              )
            ).status
          ).toBe(201);

          const failed = await call(
            unreadFails.handler,
            'GET',
            '/api/library/unread',
            alice
          );
          expect(failed.status).toBe(500);
          expect(await json(failed)).toMatchObject({
            _tag: 'ArticleRepositoryError',
            message: 'Unable to access articles',
          });

          expect(
            (await call(unreadFails.handler, 'GET', '/api/library/unread'))
              .status
          ).toBe(401);
          expect(
            await json(
              await call(
                unreadFails.handler,
                'GET',
                '/api/library/feeds',
                alice
              )
            )
          ).toMatchObject({ items: [{ id: item.id }] });
        } finally {
          await unreadFails.dispose();
        }
      }),
    (db) => Effect.promise(() => db.close())
  )
);

for (const { failure, articles, overrides } of [
  {
    failure: 'parser',
    articles: ArticleRepositoryLive,
    overrides: {
      parser: Layer.succeed(HtmlParser, {
        parse: () =>
          Effect.fail(new HtmlParserError({ message: 'parse failed' })),
      }),
    },
  },
  {
    failure: 'sanitizer',
    articles: ArticleRepositoryLive,
    overrides: {
      sanitizer: Layer.succeed(DocumentSantize, {
        sanitize: () =>
          Effect.fail(new DocumentSantizeError({ message: 'sanitize failed' })),
      }),
    },
  },
  {
    failure: 'articles',
    articles: Layer.mock(ArticleRepository, {
      create: () =>
        Effect.fail(new ArticleRepositoryError({ message: 'write failed' })),
    }),
    overrides: {},
  },
]) {
  it.effect(`maps ${failure} failures at the library HTTP boundary`, () =>
    Effect.acquireUseRelease(
      openDatabase(`route-failure-${failure}`),
      (db) =>
        Effect.promise(async () => {
          const options = await setupDatabase(db);
          const { handler, dispose } = makeHandler(
            db,
            options,
            articles,
            overrides
          );
          try {
            const alice = await signIn(handler, 'alice@example.com');
            const response = await call(
              handler,
              'POST',
              '/api/library/feeds',
              alice,
              {
                url: 'https://example.com/feed.xml',
              }
            );
            expect(response.status).toBe(422);
            const error = await json<{ id: string }>(response);
            expect(error).toMatchObject({
              _tag: 'FeedImportFailed',
              message: 'Failed to import feed articles',
              id: expect.any(String),
            });
            expect(
              await json(
                await call(handler, 'GET', '/api/library/feeds', alice)
              )
            ).toMatchObject({
              items: [{ id: error.id }],
            });

            if (failure === 'parser') {
              const added = await call(
                handler,
                'POST',
                '/api/library/articles',
                alice,
                {
                  url: 'https://example.com/manual',
                }
              );
              expect(added.status).toBe(422);
              expect(await json(added)).toMatchObject({
                _tag: 'ArticleExtractorError',
                message: 'Unable to extract article content',
              });
            }
          } finally {
            await dispose();
          }
        }),
      (db) => Effect.promise(() => db.close())
    )
  );
}

it.effect(
  'maps settings repository failures to public read and save errors',
  () =>
    Effect.acquireUseRelease(
      openDatabase('route-settings-failure'),
      (db) =>
        Effect.promise(async () => {
          const options = await setupDatabase(db);
          const unavailable = () =>
            Effect.fail(
              new SettingsRepositoryError({ message: 'database unavailable' })
            );
          const { handler, dispose } = makeHandler(
            db,
            options,
            ArticleRepositoryLive,
            {
              settings: Layer.succeed(SettingsRepository, {
                get: unavailable,
                update: unavailable,
              }),
            }
          );
          try {
            const alice = await signIn(handler, 'alice@example.com');
            const read = await call(
              handler,
              'GET',
              '/api/library/settings',
              alice
            );
            expect(read.status).toBe(500);
            expect(await json(read)).toMatchObject({
              _tag: 'SettingsReadError',
              message: 'Unable to read settings',
            });
            for (const [path, payload] of [
              ['retention', { retention: 100 }],
              ['extraction', { provider: 'jina' }],
            ] as const) {
              const saved = await call(
                handler,
                'PUT',
                `/api/library/settings/${path}`,
                alice,
                payload
              );
              expect(saved.status).toBe(500);
              expect(await json(saved)).toMatchObject({
                _tag: 'SettingsSaveError',
                message: 'Unable to save settings',
              });
            }
          } finally {
            await dispose();
          }
        }),
      (db) => Effect.promise(() => db.close())
    )
);
