import { createHash } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { surrealAdapter } from '@surrealdb/better-auth';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { AppLive } from '../../src/app';
import { Auth } from '../../src/infrastructure/auth';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { feedsSchema } from '../../src/infrastructure/feeds';
import { linksSchema } from '../../src/infrastructure/links';

const origin = 'http://localhost:3000';

type Handler = (request: Request) => Promise<Response>;

const post = (handler: Handler, path: string, body: object, headers: object) =>
  handler(
    new Request(`${origin}${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );

const signIn = async (handler: Handler, email: string): Promise<string> => {
  const credentials = {
    name: 'Reader',
    email,
    password: 'test-password-123',
  };
  const signUp = await post(
    handler,
    '/api/auth/sign-up/email',
    credentials,
    {}
  );
  expect(signUp.status).toBe(200);
  const response = await post(
    handler,
    '/api/auth/sign-in/email',
    credentials,
    {}
  );
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
  if (!payload?.user?.id) {
    throw new Error('Missing session user');
  }

  return payload.user.id;
};

const createdKey = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || !('item' in payload)) {
    throw new Error('Missing item');
  }

  const item = payload.item;
  if (
    !item ||
    typeof item !== 'object' ||
    !('key' in item) ||
    typeof item.key !== 'string'
  ) {
    throw new Error('Invalid item');
  }

  return item.key;
};

const createLink = async (handler: Handler, cookie: string, url: string) => {
  const response = await post(handler, '/api/links', { url }, { cookie });
  expect(response.status).toBe(201);

  return createdKey(await response.json());
};

const unreadLinks = async (handler: Handler, cookie: string) => {
  const response = await handler(
    new Request(`${origin}/api/links/unread-count`, { headers: { cookie } })
  );
  const payload = (await response.json()) as { count: number };

  return payload.count;
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

const unreadArticles = async (
  handler: Handler,
  cookie: string,
  feedKey: string
) => {
  const query = new URLSearchParams({ feedKey, read: 'false' });
  const response = await handler(
    new Request(`${origin}/api/feeds/articles?${query}`, {
      headers: { cookie },
    })
  );
  const payload = (await response.json()) as { items: { key: string }[] };

  return payload.items.map(({ key }) => key);
};

const verifyLinkScope = async (
  handler: Handler,
  alice: string,
  bob: string
) => {
  const first = await createLink(handler, alice, 'http://127.0.0.1/loaded-a');
  const second = await createLink(handler, alice, 'http://127.0.0.1/loaded-b');
  const other = await createLink(handler, bob, 'http://127.0.0.1/bob-loaded');
  const send = (
    cookie: string,
    keys: readonly string[],
    requestOrigin = origin
  ) =>
    post(
      handler,
      '/api/links/mark-loaded',
      { keys },
      { cookie, origin: requestOrigin }
    );
  expect((await send(alice, [], 'https://untrusted.example')).status).toBe(403);
  expect(await (await send(alice, [])).json()).toEqual({ ok: true });
  expect(await unreadLinks(handler, alice)).toBe(2);
  expect(await unreadLinks(handler, bob)).toBe(1);
  expect((await send(alice, ['not-a-key'])).status).toBe(400);
  expect(await (await send(alice, [first, other])).json()).toEqual({
    ok: true,
  });
  expect(await unreadLinks(handler, alice)).toBe(1);
  expect(await unreadLinks(handler, bob)).toBe(1);
  const listed = await handler(
    new Request(`${origin}/api/links?read=false`, {
      headers: { cookie: alice },
    })
  );
  const remaining = (await listed.json()) as { items: { key: string }[] };
  expect(remaining.items.map(({ key }) => key)).toEqual([second]);
};

const verifyFeedScope = async (
  handler: Handler,
  db: Database['Service'],
  alice: string,
  bob: string
) => {
  const aliceId = await sessionUserId(handler, alice);
  const bobId = await sessionUserId(handler, bob);
  await seedArticles(db, aliceId, 'feed-loaded', 4, 1000000);
  await seedArticles(db, bobId, 'feed-bob', 3, 2000000);
  const aliceKeys = await unreadArticles(handler, alice, 'feed-loaded');
  const bobKeys = await unreadArticles(handler, bob, 'feed-bob');
  expect(aliceKeys).toHaveLength(4);
  expect(bobKeys).toHaveLength(3);
  const send = (
    cookie: string,
    keys: readonly string[],
    requestOrigin = origin
  ) =>
    post(
      handler,
      '/api/feeds/articles/mark-loaded',
      { keys },
      { cookie, origin: requestOrigin }
    );
  expect((await send(alice, [], 'https://untrusted.example')).status).toBe(403);
  expect(await (await send(alice, [])).json()).toEqual({ ok: true });
  expect(await unreadArticles(handler, alice, 'feed-loaded')).toHaveLength(4);
  expect((await send(alice, ['not-a-key'])).status).toBe(400);
  expect(
    await (await send(alice, [aliceKeys[0] ?? '', bobKeys[0] ?? ''])).json()
  ).toEqual({ ok: true });
  expect(await unreadArticles(handler, alice, 'feed-loaded')).toEqual(
    aliceKeys.slice(1)
  );
  expect(await unreadArticles(handler, bob, 'feed-bob')).toEqual(bobKeys);
};

const verifyRemovedRefresh = async (handler: Handler, alice: string) => {
  const refresh = await post(
    handler,
    '/api/feeds/refresh',
    { key: 'a'.repeat(64) },
    { cookie: alice }
  );
  expect(refresh.status).toBe(404);
  const subscribe = await post(
    handler,
    '/api/feeds',
    { url: 'javascript:alert(1)' },
    { cookie: alice }
  );
  expect(subscribe.status).toBe(400);
  expect(
    (await post(handler, '/api/feeds', { url: 'https://x.example' }, {})).status
  ).toBe(401);
};

const verifyRoutes = async (handler: Handler, db: Database['Service']) => {
  const alice = await signIn(handler, 'alice@example.com');
  const bob = await signIn(handler, 'bob@example.com');
  expect(
    (await post(handler, '/api/links/mark-loaded', { keys: [] }, {})).status
  ).toBe(401);
  expect(
    (await post(handler, '/api/feeds/articles/mark-loaded', { keys: [] }, {}))
      .status
  ).toBe(401);
  await verifyLinkScope(handler, alice, bob);
  await verifyFeedScope(handler, db, alice, bob);
  await verifyRemovedRefresh(handler, alice);
};

it.effect(
  'marks only loaded snapshot keys and keeps public refresh unavailable',
  () =>
    Effect.acquireUseRelease(
      Effect.promise(() =>
        createSurreal({
          endpoint: 'mem://',
          namespace: 'route-mark-loaded',
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
          const schema = await options
            .database(options)
            .createSchema?.(options);
          if (schema?.code) {
            await db.query(schema.code);
          }

          await db.query(linksSchema);
          await db.query(feedsSchema);
          const routes = AppLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Auth, betterAuth<BetterAuthOptions>(options)),
                Layer.succeed(Database, db)
              )
            )
          );
          const { handler, dispose } = HttpRouter.toWebHandler(routes, {
            disableLogger: true,
          });
          try {
            await verifyRoutes(handler, db);
          } finally {
            await dispose();
          }
        }),
      (db) => Effect.promise(() => db.close())
    )
);
