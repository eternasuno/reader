import { createHash } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { FeedFetcher, FeedPreviewStore } from '@reader/business';
import { surrealAdapter } from '@surrealdb/better-auth';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { AppLive } from '../../src/app';
import { Auth } from '../../src/infrastructure/auth';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { feedsSchema } from '../../src/infrastructure/feeds';

const origin = 'http://localhost:3000';

type Handler = (request: Request) => Promise<Response>;
type Article = {
  key: string;
  feedKey: string;
  publishedAt: string;
  read: boolean;
};
type Page = { items: Article[]; hasMore: boolean };

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

const sessionUserId = async (handler: Handler, cookie: string) => {
  const response = await handler(
    new Request(`${origin}/api/auth/get-session`, { headers: { cookie } })
  );
  const payload = (await response.json()) as {
    user?: { id?: string };
  } | null;
  const id = payload?.user?.id;
  if (!id) {
    throw new Error('Missing session user');
  }

  return id;
};

const seedArticles = async (
  db: Database['Service'],
  owner: string,
  feedKey: string,
  count: number,
  baseTime: number
) => {
  for (let index = 0; index < count; index++) {
    const key = createHash('sha256')
      .update(`${owner}:${feedKey}:${index}`)
      .digest('hex');
    await db.query(
      'CREATE feed_article SET owner = $owner, feedKey = $feedKey, key = $key, url = $url, title = $title, publishedAt = $publishedAt, read = false;',
      {
        owner,
        feedKey,
        key,
        url: `https://example.com/${feedKey}/${index}`,
        title: String(index),
        publishedAt: new Date(baseTime + index * 1000).toISOString(),
      }
    );
  }
};

type FeedGet = (cookie: string, query: string) => Promise<Page>;
type FeedMark = (
  cookie: string,
  key: string,
  read: boolean
) => Promise<Response>;
type FeedMarkAll = (
  cookie: string,
  feedKey: string,
  requestOrigin?: string
) => Promise<Response>;

const makeFeedRequests = (handler: Handler) => ({
  get: async (cookie: string, query: string) =>
    (await (
      await handler(
        new Request(`${origin}/api/feeds/articles?${query}`, {
          headers: { cookie },
        })
      )
    ).json()) as Page,
  mark: (cookie: string, key: string, read: boolean) =>
    handler(
      new Request(`${origin}/api/feeds/articles`, {
        method: 'PATCH',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ key, read }),
      })
    ),
  markAll: (cookie: string, feedKey: string, requestOrigin = origin) =>
    handler(
      new Request(`${origin}/api/feeds/articles/mark-all`, {
        method: 'POST',
        headers: {
          cookie,
          origin: requestOrigin,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ feedKey }),
      })
    ),
});

const verifyCursorPaging = async (
  get: FeedGet,
  mark: FeedMark,
  alice: string
) => {
  const page = await get(alice, 'feedKey=&read=false&offset=0');
  expect(page.items).toHaveLength(30);
  expect(page.hasMore).toBe(true);
  const last = page.items[29];
  for (const article of page.items.slice(0, 3)) {
    expect((await mark(alice, article.key, true)).status).toBe(200);
  }

  const cursor = await get(
    alice,
    new URLSearchParams({
      feedKey: '',
      read: 'false',
      offset: '0',
      before: last?.publishedAt ?? '',
      beforeKey: last?.key ?? '',
    }).toString()
  );
  expect(cursor.items).toHaveLength(10);
  expect(
    cursor.items.some((article) =>
      page.items.some(({ key }) => key === article.key)
    )
  ).toBe(false);
  expect(
    (await get(alice, 'feedKey=&read=false&offset=30')).items
  ).toHaveLength(7);

  return last;
};

const verifyAllFilter = async (
  get: FeedGet,
  alice: string,
  last: Article | undefined
) => {
  const all = await get(alice, 'feedKey=&read=false&all=true');
  expect(all.items).toHaveLength(30);
  expect(all.items.filter(({ read }) => read)).toHaveLength(3);
  const allCursor = await get(
    alice,
    new URLSearchParams({
      feedKey: '',
      read: 'false',
      offset: '0',
      all: 'true',
      before: last?.publishedAt ?? '',
      beforeKey: last?.key ?? '',
    }).toString()
  );
  expect(allCursor.items).toHaveLength(10);
};

const verifyBulkMarks = async (
  get: FeedGet,
  markAll: FeedMarkAll,
  alice: string,
  bob: string
) => {
  expect(
    (await markAll(alice, 'feed-b', 'https://untrusted.example')).status
  ).toBe(403);
  expect(await (await markAll(alice, 'feed-b')).json()).toEqual({ ok: true });
  expect((await get(alice, 'feedKey=feed-b&read=false')).items).toEqual([]);
  expect((await get(alice, 'feedKey=feed-a&read=false')).items).toHaveLength(
    30
  );
  expect((await get(bob, 'feedKey=&read=false')).items).toHaveLength(3);

  expect(await (await markAll(alice, '')).json()).toEqual({ ok: true });
  expect((await get(alice, 'feedKey=&read=false')).items).toEqual([]);
  expect((await get(bob, 'feedKey=&read=false')).items).toHaveLength(3);
  expect(await (await markAll(bob, '')).json()).toEqual({ ok: true });
  expect((await get(bob, 'feedKey=&read=false')).items).toEqual([]);
};

const verifyFeeds = async (handler: Handler, db: Database['Service']) => {
  expect(
    (await handler(new Request(`${origin}/api/feeds/articles?feedKey=`))).status
  ).toBe(401);
  expect(
    (
      await handler(
        new Request(`${origin}/api/feeds/articles/mark-all`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin },
          body: JSON.stringify({ feedKey: '' }),
        })
      )
    ).status
  ).toBe(401);
  const alice = await signIn(handler, 'alice@example.com');
  const bob = await signIn(handler, 'bob@example.com');
  const aliceId = await sessionUserId(handler, alice);
  const bobId = await sessionUserId(handler, bob);
  await seedArticles(db, aliceId, 'feed-a', 35, 1000000);
  await seedArticles(db, aliceId, 'feed-b', 5, 2000000);
  await seedArticles(db, bobId, 'feed-c', 3, 3000000);

  const { get, mark, markAll } = makeFeedRequests(handler);
  const last = await verifyCursorPaging(get, mark, alice);
  await verifyAllFilter(get, alice, last);
  await verifyBulkMarks(get, markAll, alice, bob);
};

it.effect('pages unread feed articles and bulk marks owner-scoped feeds', () =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: 'route-feeds',
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

        await db.query(feedsSchema);
        const routes = AppLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(Auth, betterAuth<BetterAuthOptions>(options)),
              Layer.succeed(Database, db),
              Layer.mock(FeedPreviewStore, {}),
              Layer.mock(FeedFetcher, {})
            )
          )
        );
        const { handler, dispose } = HttpRouter.toWebHandler(routes, {
          disableLogger: true,
        });
        try {
          await verifyFeeds(handler, db);
        } finally {
          await dispose();
        }
      }),
    (db) => Effect.promise(() => db.close())
  )
);
