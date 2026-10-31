// biome-ignore-all lint/style/noExcessiveLinesPerFile: one integration scenario exercises the library API boundary.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: the scenario follows the user journey in order.
import { randomBytes } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { surrealAdapter } from '@surrealdb/better-auth';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { ConfigProvider, Effect, Layer, Schema } from 'effect';
import { HttpRouter } from 'effect/http';
import { ArticleExtractor } from '../../../../packages/business/src/port/article-extractor.ts';
import { ContentProcessor } from '../../../../packages/business/src/port/content-processor.ts';
import { Syndication } from '../../../../packages/business/src/port/syndication.ts';
import { WebpageFetcher } from '../../../../packages/business/src/port/webpage-fetcher.ts';
import { HttpFetchLive } from '../../../../packages/webpage/src/http.ts';
import {
  ArticleItemSchema,
  ArticlePageSchema,
} from '../../../web/src/lib/library-schema.ts';
import { ExtractionSettingsLive } from '../../src/adapter/extraction-settings';
import { ReaderCredentialsLive } from '../../src/adapter/reader-credentials';
import {
  ReaderStoreLive,
  readerStoreSchema,
} from '../../src/adapter/reader-store';
import { AppLive } from '../../src/app';
import { Auth } from '../../src/infrastructure/auth';
import { CredentialCryptoLive } from '../../src/infrastructure/credential-crypto';
import { createSurreal, Database } from '../../src/infrastructure/db';

const origin = 'http://localhost:3000';

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

type FeedItem = { readonly id: string; readonly title: string };
type ArticleItem = {
  readonly id: string;
  readonly title: string;
  readonly read: boolean;
  readonly extractedContent?: string;
};
type Page = {
  readonly items: readonly ArticleItem[];
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
      titles: readonly string[];
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
    _tag: 'SubscriptionExists',
    message: 'Subscription already exists',
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
  const feeds = await json<{ items: readonly FeedItem[] }>(
    await call(handler, 'GET', '/api/library/feeds', alice)
  );
  expect(feeds.items.map(({ id }) => id)).toEqual([feedId]);
  expect(
    await json(await call(handler, 'GET', '/api/library/feeds', bob))
  ).toEqual({ items: [] });

  expect(
    await json(await call(handler, 'GET', '/api/library/feeds/unread', alice))
  ).toEqual({ total: 4, feeds: [{ id: feedId, count: 4 }] });
  expect(
    await json(await call(handler, 'GET', '/api/library/later/unread', alice))
  ).toEqual({ count: 0 });

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
  const page = await Schema.decodeUnknownPromise(ArticlePageSchema)(
    JSON.parse(feedPageText)
  );
  expect(page.items.map(({ title }) => title).toSorted()).toEqual(
    ['One', 'Two', 'Three', 'Four'].toSorted()
  );
  expect(page.cursor).toBeNull();

  const first = page.items[0];
  if (first === undefined) {
    throw new Error('Missing seeded article');
  }
  expect(Object.hasOwn(first, 'content')).toBe(false);
  expect(Object.hasOwn(first, 'extractedContent')).toBe(false);

  const saved = await call(
    handler,
    'POST',
    '/api/library/articles/save',
    alice,
    { id: first.id }
  );
  expect(saved.status).toBe(200);
  const { item: later } = await json<{ item: ArticleItem }>(saved);
  expect(
    await json(await call(handler, 'GET', '/api/library/later/unread', alice))
  ).toEqual({ count: 1 });

  expect(
    (
      await call(handler, 'PATCH', '/api/library/articles', alice, {
        id: first.id,
        read: true,
      })
    ).status
  ).toBe(200);
  expect(
    await json(await call(handler, 'GET', '/api/library/feeds/unread', alice))
  ).toEqual({ total: 3, feeds: [{ id: feedId, count: 3 }] });

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
  expect(
    await json(await call(handler, 'GET', '/api/library/later/unread', alice))
  ).toEqual({ count: 0 });

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
  const { item: urlLessLater } = await Schema.decodeUnknownPromise(
    ArticleItemSchema
  )(JSON.parse(savedUrlLessText));
  expect(urlLessLater.feedId).toBeUndefined();
  expect(urlLessLater.url).toBeUndefined();

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
  expect(
    await json(await call(handler, 'GET', '/api/library/later/unread', alice))
  ).toEqual({ count: 1 });
};

const verifySettings = async (handler: Handler, alice: string) => {
  expect(
    await json(await call(handler, 'GET', '/api/library/settings', alice))
  ).toEqual({
    retention: 100,
    provider: 'jina',
    jinaConfigured: false,
    browserEndpoint: '',
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
    (
      await call(handler, 'PUT', '/api/library/settings/extraction', alice, {
        provider: 'browser',
        browserEndpoint: 'http://127.0.0.1:9222',
      })
    ).status
  ).toBe(200);
  expect(
    await json(await call(handler, 'GET', '/api/library/settings', alice))
  ).toEqual({
    retention: 120,
    provider: 'browser',
    jinaConfigured: false,
    browserEndpoint: 'http://127.0.0.1:9222',
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
    browserEndpoint: '',
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
  expect(
    await json(await call(handler, 'GET', '/api/library/feeds/unread', alice))
  ).toEqual({ total: 0, feeds: [] });
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

const syndication = Layer.succeed(Syndication, {
  fetch: () =>
    Effect.succeed({
      title: 'Example feed',
      description: 'Daily updates',
      articles: [
        {
          title: 'One',
          url: new URL('https://example.com/one'),
        },
        {
          title: 'Two',
          url: new URL('https://example.com/two'),
        },
        {
          title: 'Three',
          url: new URL('https://example.com/three'),
        },
        {
          title: 'Four',
        },
      ],
    }),
});

const articleExtractor = Layer.succeed(ArticleExtractor, {
  extract: () =>
    Effect.succeed({ title: 'Example article', html: '<p>Body</p>' }),
});

const makeConfig = () =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      READER_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    })
  );

it.effect('serves authenticated owner-scoped library operations', () =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: 'route-library',
        database: 'test',
      })
    ),
    (db) =>
      Effect.promise(async () => {
        const options = {
          baseURL: origin,
          secret: 'test-only-secret-at-least-32-characters',
          emailAndPassword: { enabled: true, autoSignIn: false },
          database: surrealAdapter({ db }),
        };
        const schema = await options.database(options).createSchema?.(options);
        if (schema?.code) {
          await db.query(schema.code);
        }

        await db.query(readerStoreSchema);
        const config = makeConfig();
        const crypto = CredentialCryptoLive.pipe(Layer.provide(config));
        const business = Layer.mergeAll(
          ReaderStoreLive,
          ExtractionSettingsLive,
          ReaderCredentialsLive,
          syndication,
          Layer.succeed(ContentProcessor, {
            process: (content) => Effect.succeed(content),
          }),
          Layer.succeed(WebpageFetcher, {
            fetch: () =>
              Effect.succeed('<html><body><p>Body</p></body></html>'),
          }),
          articleExtractor,
          HttpFetchLive
        ).pipe(
          Layer.provide(Layer.mergeAll(Layer.succeed(Database, db), crypto))
        );
        const routes = AppLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Auth, betterAuth<BetterAuthOptions>(options)),
              business
            )
          )
        );
        const { handler, dispose } = HttpRouter.toWebHandler(routes, {
          disableLogger: true,
        });
        try {
          await verifyLibrary(handler);
        } finally {
          await dispose();
        }
      }),
    (db) => Effect.promise(() => db.close())
  )
);
