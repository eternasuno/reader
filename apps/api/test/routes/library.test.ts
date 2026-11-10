// biome-ignore-all lint/style/noExcessiveLinesPerFile: one integration scenario exercises the library API boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: the scenario follows the user journey in order.
import { expect, it } from '@effect/vitest';
import {
  ArticleContent,
  ArticleDescription,
  ArticleExtractor,
  ArticleTitle,
  DocumentSanitizer,
  DocumentSanitizerError,
  FeedItemRepository,
  FeedItemRepositoryError,
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
  FeedItemPageSchema,
  SavedPagePageSchema,
  SavedPageResponseSchema,
  UnreadCountsSchema,
} from '../../../web/src/lib/library-schema.ts';
import { FeedFetcherLive } from '../../src/adapter/feed-fetcher';
import { makeFeedItems } from '../../src/adapter/feed-item-store';
import { HtmlParserLive } from '../../src/adapter/html-parser';
import {
  FeedItemRepositoryLive,
  FeedRepositoryLive,
  ReaderStoreConcurrency,
  ReaderStoreConcurrencyLive,
  readerStoreSchema,
  SavedPageRepositoryLive,
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

type Feed = { readonly id: string; readonly title: string };

type ItemSummary = {
  readonly id: string;
  readonly title: string;
  readonly read: boolean;
  readonly content?: string;
  readonly extractedContent?: string;
};

type ItemRef = { readonly id: string; readonly title: string };

type Failure = { readonly _tag: string; readonly message: string };

const verifyAuthAndPreview = async (handler: Handler, alice: string) => {
  expect((await call(handler, 'GET', '/api/library/saved-pages')).status).toBe(
    401
  );
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
      titles: ['One', 'Two', 'Three', 'Four', 'Five'],
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
  const { item } = await json<{ item: Feed }>(subscribed);
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

const feedItemTitles = ['One', 'Two', 'Three', 'Four', 'Five'];

const verifyFeedItems = async (
  handler: Handler,
  alice: string,
  bob: string,
  feedId: string
) => {
  const feeds = await json<{ items: ReadonlyArray<Feed> }>(
    await call(handler, 'GET', '/api/library/feeds', alice)
  );
  expect(feeds.items.map(({ id }) => id)).toEqual([feedId]);
  expect(
    await json(await call(handler, 'GET', '/api/library/feeds', bob))
  ).toEqual({ items: [] });

  expect(await readCounts(handler, alice)).toEqual({
    saved: 0,
    feedsTotal: 5,
    feeds: [{ id: feedId, count: 5 }],
  });
  expect(await readCounts(handler, bob)).toEqual({
    saved: 0,
    feedsTotal: 0,
    feeds: [],
  });
  expect((await call(handler, 'GET', '/api/library/unread')).status).toBe(401);

  const pageText = await (
    await call(
      handler,
      'GET',
      `/api/library/feeds/items?feedId=${feedId}&filter=unread`,
      alice
    )
  ).text();
  expect(pageText).not.toContain('"description":null');
  expect(pageText).not.toContain('"content":null');
  expect(pageText).not.toContain('"extractedContent":null');
  const payload = JSON.parse(pageText) as {
    readonly items: ReadonlyArray<object>;
  };
  const page = await Schema.decodeUnknownPromise(FeedItemPageSchema)(payload);
  expect(page.items.map(({ title }) => title).toSorted()).toEqual(
    feedItemTitles.toSorted()
  );
  expect(page.cursor).toBeNull();
  const rawTwo = payload.items[page.items.findIndex((i) => i.title === 'Two')];
  expect(Object.hasOwn(rawTwo ?? {}, 'content')).toBe(false);
  expect(Object.hasOwn(rawTwo ?? {}, 'extractedContent')).toBe(false);

  return page.items;
};

const verifyForeignFeedAccess = async (
  handler: Handler,
  bob: string,
  feedId: string,
  itemId: string
) => {
  for (const response of [
    await call(
      handler,
      'GET',
      `/api/library/feeds/items?feedId=${feedId}`,
      bob
    ),
    await call(
      handler,
      'GET',
      `/api/library/feeds/items/item?feedId=${feedId}&id=${itemId}`,
      bob
    ),
    await call(handler, 'PATCH', '/api/library/feeds/items', bob, {
      feedId,
      id: itemId,
      read: true,
    }),
    await call(
      handler,
      'POST',
      '/api/library/saved-pages/from-feed-item',
      bob,
      {
        feedId,
        id: itemId,
      }
    ),
    await call(handler, 'POST', '/api/library/feeds/items/extract', bob, {
      feedId,
      id: itemId,
    }),
  ]) {
    expect(response.status).toBe(404);
    expect(await json<Failure>(response)).toMatchObject({
      _tag: 'FeedNotFound',
    });
  }
};

const itemOf = (items: ReadonlyArray<ItemRef>, title: string): ItemRef => {
  const found = items.find((item) => item.title === title);
  if (found === undefined) {
    throw new Error(`Missing seeded item ${title}`);
  }

  return found;
};

const verifySavingFeedItems = async (
  handler: Handler,
  alice: string,
  bob: string,
  feedId: string,
  items: ReadonlyArray<ItemRef>
) => {
  const one = itemOf(items, 'One');
  await verifyForeignFeedAccess(handler, bob, feedId, one.id);

  const saved = await call(
    handler,
    'POST',
    '/api/library/saved-pages/from-feed-item',
    alice,
    { feedId, id: one.id }
  );
  expect(saved.status).toBe(200);
  const { item: page } = await Schema.decodeUnknownPromise(
    SavedPageResponseSchema
  )(await json(saved));
  expect(page.content).toBe('<p>Body</p>');
  expect(await readCounts(handler, alice)).toEqual({
    saved: 1,
    feedsTotal: 5,
    feeds: [{ id: feedId, count: 5 }],
  });

  const again = await call(
    handler,
    'POST',
    '/api/library/saved-pages/from-feed-item',
    alice,
    { feedId, id: one.id }
  );
  expect(again.status).toBe(409);
  expect(await json(again)).toMatchObject({
    _tag: 'DuplicateSavedPage',
    id: page.id,
  });

  expect(
    (
      await call(handler, 'PATCH', '/api/library/feeds/items', alice, {
        feedId,
        id: one.id,
        read: true,
      })
    ).status
  ).toBe(200);
  expect(await readCounts(handler, alice)).toMatchObject({
    saved: 1,
    feedsTotal: 4,
  });

  const savedList = `/api/library/saved-pages?filter=all`;
  expect(
    await json(await call(handler, 'GET', savedList, alice))
  ).toMatchObject({ items: [{ id: page.id, read: false }], cursor: null });
  expect(await json(await call(handler, 'GET', savedList, bob))).toEqual({
    items: [],
    cursor: null,
    boundary: null,
  });

  expect(
    (
      await call(
        handler,
        'POST',
        '/api/library/saved-pages/mark-all-read',
        alice,
        {}
      )
    ).status
  ).toBe(200);
  expect(await readCounts(handler, alice)).toMatchObject({ saved: 0 });
  expect(
    (
      await call(handler, 'DELETE', '/api/library/saved-pages', alice, {
        id: page.id,
      })
    ).status
  ).toBe(200);
  expect(await json(await call(handler, 'GET', savedList, alice))).toEqual({
    items: [],
    cursor: null,
    boundary: null,
  });
};

const verifyLinklessItem = async (
  handler: Handler,
  alice: string,
  feedId: string,
  items: ReadonlyArray<ItemRef>
) => {
  const four = itemOf(items, 'Four');
  const saved = await call(
    handler,
    'POST',
    '/api/library/saved-pages/from-feed-item',
    alice,
    { feedId, id: four.id }
  );
  expect(saved.status).toBe(200);
  const savedText = await saved.text();
  expect(savedText).not.toContain('"url":null');
  const payload = JSON.parse(savedText) as { readonly item: object };
  expect(Object.hasOwn(payload.item, 'url')).toBe(false);
  const { item } = await Schema.decodeUnknownPromise(SavedPageResponseSchema)(
    payload
  );
  expect(item.content).toBe('<p>Body</p>');

  const listText = await (
    await call(handler, 'GET', '/api/library/saved-pages?filter=all', alice)
  ).text();
  expect(listText).not.toContain('"url":null');
  const list = await Schema.decodeUnknownPromise(SavedPagePageSchema)(
    JSON.parse(listText)
  );
  expect(list.items.map(({ id }) => id)).toEqual([item.id]);
  expect(
    (
      await call(handler, 'DELETE', '/api/library/saved-pages', alice, {
        id: item.id,
      })
    ).status
  ).toBe(200);

  const five = itemOf(items, 'Five');
  const empty = await call(
    handler,
    'POST',
    '/api/library/saved-pages/from-feed-item',
    alice,
    { feedId, id: five.id }
  );
  expect(empty.status).toBe(422);
  expect(await json<Failure>(empty)).toMatchObject({
    _tag: 'ArticleEmptyContent',
  });
};

const verifyFeedItemOperations = async (
  handler: Handler,
  alice: string,
  feedId: string,
  items: ReadonlyArray<ItemRef>
) => {
  const two = itemOf(items, 'Two');
  const extracted = await json<{ item: ItemSummary }>(
    await call(handler, 'POST', '/api/library/feeds/items/extract', alice, {
      feedId,
      id: two.id,
    })
  );
  expect(extracted.item.extractedContent).toBe('<p>Body</p>');
  const fetched = await json<{ item: ItemSummary | null }>(
    await call(
      handler,
      'GET',
      `/api/library/feeds/items/item?feedId=${feedId}&id=${two.id}`,
      alice
    )
  );
  expect(fetched.item?.extractedContent).toBe('<p>Body</p>');

  const three = itemOf(items, 'Three');
  expect(
    (
      await call(handler, 'POST', '/api/library/feeds/items/mark-read', alice, {
        feedId,
        ids: [two.id, three.id],
      })
    ).status
  ).toBe(200);
  expect(await readCounts(handler, alice)).toMatchObject({ feedsTotal: 2 });
  expect(
    (
      await call(handler, 'POST', '/api/library/feeds/mark-read', alice, {
        feedIds: [feedId, 'f'.repeat(64)],
      })
    ).status
  ).toBe(200);
  expect(await readCounts(handler, alice)).toEqual({
    saved: 0,
    feedsTotal: 0,
    feeds: [],
  });
};

const verifyAddedPage = async (handler: Handler, alice: string) => {
  const added = await call(handler, 'POST', '/api/library/saved-pages', alice, {
    url: 'https://example.com/manual',
  });
  expect(added.status).toBe(201);
  const { item } = await json<{ item: ItemSummary }>(added);
  expect(item.title).toBe('Example article');
  expect(item.content).toBe('<p>Body</p>');

  const fetched = await json<{ item: ItemSummary | null }>(
    await call(
      handler,
      'GET',
      `/api/library/saved-pages/item?id=${item.id}`,
      alice
    )
  );
  expect(fetched.item?.id).toBe(item.id);
  expect(await readCounts(handler, alice)).toMatchObject({ saved: 1 });

  const duplicate = await call(
    handler,
    'POST',
    '/api/library/saved-pages',
    alice,
    { url: 'https://example.com/manual' }
  );
  expect(duplicate.status).toBe(409);
  expect(await json(duplicate)).toMatchObject({
    _tag: 'DuplicateSavedPage',
    id: item.id,
  });

  const invalid = await call(
    handler,
    'POST',
    '/api/library/saved-pages',
    alice,
    {
      url: 'ftp://example.com/manual',
    }
  );
  expect(invalid.status).toBe(400);
  expect(await json<Failure>(invalid)).toMatchObject({
    _tag: 'InvalidPageUrl',
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
  const lowRetention = await call(
    handler,
    'PUT',
    '/api/library/settings/retention',
    alice,
    { retention: 10 }
  );
  expect(lowRetention.status).toBe(400);
  expect(await json<Failure>(lowRetention)).toEqual({
    _tag: 'InvalidRetention',
    message: 'Retention must be an integer between 30 and 300',
  });

  const extraction = (payload: object) =>
    call(handler, 'PUT', '/api/library/settings/extraction', alice, payload);
  expect(await json<Failure>(await extraction({ provider: 'other' }))).toEqual({
    _tag: 'InvalidProvider',
    message: 'Choose a valid extraction provider',
  });
  expect(
    await json<Failure>(await extraction({ provider: 'jina', jinaKey: '   ' }))
  ).toEqual({ _tag: 'InvalidKey', message: 'Enter a valid Jina API key' });
  expect(
    await json<Failure>(await extraction({ provider: 'browser' }))
  ).toEqual({
    _tag: 'InvalidEndpoint',
    message: 'Enter a valid browser service address',
  });

  expect(
    (
      await extraction({
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
  bob: string,
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
    (await call(handler, 'DELETE', '/api/library/feeds', bob, { id: feedId }))
      .status
  ).toBe(404);
  expect(
    (await call(handler, 'DELETE', '/api/library/feeds', alice, { id: feedId }))
      .status
  ).toBe(200);
  expect(
    await json(await call(handler, 'GET', '/api/library/feeds', alice))
  ).toEqual({ items: [] });
  expect(await readCounts(handler, alice)).toEqual({
    saved: 1,
    feedsTotal: 0,
    feeds: [],
  });
};

const verifyLibrary = async (handler: Handler) => {
  const alice = await signIn(handler, 'alice@example.com');
  const bob = await signIn(handler, 'bob@example.com');

  await verifyAuthAndPreview(handler, alice);
  const subscription = await subscribe(handler, alice);
  const items = await verifyFeedItems(handler, alice, bob, subscription.id);
  await verifySavingFeedItems(handler, alice, bob, subscription.id, items);
  await verifyLinklessItem(handler, alice, subscription.id, items);
  await verifyFeedItemOperations(handler, alice, subscription.id, items);
  await verifyAddedPage(handler, alice);
  await verifySettings(handler, alice);
  await verifyUnsubscribe(handler, alice, bob, subscription.id);
};

const seededItem = (
  title: string,
  options: { readonly url?: string; readonly content?: string }
) => ({
  title: Schema.decodeSync(ArticleTitle)(title),
  url:
    options.url === undefined
      ? Option.none()
      : Option.some(decodeUrl(options.url)),
  description: decodeDescription(undefined),
  content: decodeContent(options.content),
  publishedAt,
});

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
        items: [
          seededItem('One', {
            url: 'https://example.com/one',
            content: '<p>One</p>',
          }),
          seededItem('Two', { url: 'https://example.com/two' }),
          seededItem('Three', { url: 'https://example.com/three' }),
          seededItem('Four', { content: '<p>Four</p>' }),
          seededItem('Five', {}),
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

type FeedItemStore = Layer.Layer<
  FeedItemRepository,
  never,
  Database | ReaderStoreConcurrency
>;

const failingCounts = (
  db: Surreal
): Layer.Layer<FeedItemRepository, never, ReaderStoreConcurrency> =>
  Layer.effect(
    FeedItemRepository,
    Effect.gen(function* () {
      const lock = yield* ReaderStoreConcurrency;
      const feedItems = makeFeedItems(db, lock);

      return {
        ...feedItems,
        unreadCounts: () =>
          Effect.fail(
            new FeedItemRepositoryError({ message: 'Unread count failed' })
          ),
      };
    })
  );

const makeHandler = (
  db: Surreal,
  options: ReturnType<typeof authOptions>,
  feedItems: FeedItemStore,
  overrides: {
    readonly parser?: Layer.Layer<HtmlParser>;
    readonly sanitizer?: Layer.Layer<DocumentSanitizer>;
    readonly settings?: Layer.Layer<SettingsRepository>;
  } = {}
) => {
  const services = Layer.mergeAll(
    feedItems,
    SavedPageRepositoryLive,
    FeedRepositoryLive,
    overrides.settings ?? SettingsRepositoryLive,
    feedSource,
    overrides.sanitizer ??
      Layer.succeed(DocumentSanitizer, {
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
          FeedItemRepositoryLive
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
          const { item } = await json<{ item: Feed }>(subscribed);

          const failed = await call(
            unreadFails.handler,
            'GET',
            '/api/library/unread',
            alice
          );
          expect(failed.status).toBe(500);
          expect(await json(failed)).toMatchObject({
            _tag: 'FeedItemRepositoryError',
            message: 'Unable to access feed items',
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

for (const { failure, feedItems, overrides } of [
  {
    failure: 'parser',
    feedItems: FeedItemRepositoryLive,
    overrides: {
      parser: Layer.succeed(HtmlParser, {
        parse: () =>
          Effect.fail(new HtmlParserError({ message: 'parse failed' })),
      }),
    },
  },
  {
    failure: 'sanitizer',
    feedItems: FeedItemRepositoryLive,
    overrides: {
      sanitizer: Layer.succeed(DocumentSanitizer, {
        sanitize: () =>
          Effect.fail(
            new DocumentSanitizerError({ message: 'sanitize failed' })
          ),
      }),
    },
  },
  {
    failure: 'feed items',
    feedItems: Layer.mock(FeedItemRepository, {
      create: () =>
        Effect.fail(new FeedItemRepositoryError({ message: 'write failed' })),
    }),
    overrides: {},
  },
]) {
  it.effect(`maps ${failure} failures at the library HTTP boundary`, () =>
    Effect.acquireUseRelease(
      openDatabase(`route-failure-${failure.replace(' ', '-')}`),
      (db) =>
        Effect.promise(async () => {
          const options = await setupDatabase(db);
          const { handler, dispose } = makeHandler(
            db,
            options,
            feedItems,
            overrides
          );
          try {
            const alice = await signIn(handler, 'alice@example.com');
            const response = await call(
              handler,
              'POST',
              '/api/library/feeds',
              alice,
              { url: 'https://example.com/feed.xml' }
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
            ).toMatchObject({ items: [{ id: error.id }] });

            if (failure === 'parser') {
              const added = await call(
                handler,
                'POST',
                '/api/library/saved-pages',
                alice,
                { url: 'https://example.com/manual' }
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
            FeedItemRepositoryLive,
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
