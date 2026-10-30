import { expect, it } from '@effect/vitest';
import { FeedFetcher, FeedPreviewStore } from '@reader/business';
import { surrealAdapter } from '@surrealdb/better-auth';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { AppLive } from '../../src/app';
import { Auth } from '../../src/infrastructure/auth';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { linksSchema } from '../../src/infrastructure/links';

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

const savedItem = async (response: Response) => {
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('item' in payload)) {
    throw new Error('Missing item');
  }

  const item = payload.item;
  if (
    !item ||
    typeof item !== 'object' ||
    !('key' in item) ||
    !('url' in item)
  ) {
    throw new Error('Invalid item');
  }

  return item;
};

const verifyCrossSite = async (handler: Handler, cookie: string) => {
  const response = await handler(
    new Request('http://localhost:3001/api/links', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://untrusted.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com/' }),
    })
  );
  expect(response.status).toBe(403);
};

const callLinks =
  (handler: Handler) => (method: string, cookie: string, body?: object) =>
    handler(
      new Request('http://localhost:3001/api/links', {
        method,
        headers: { cookie, origin, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );

const readUnreadCount = (handler: Handler) => (cookie: string) =>
  handler(
    new Request(`${origin}/api/links/unread-count`, { headers: { cookie } })
  );

const readLinks = (handler: Handler) => (cookie: string, query: string) =>
  handler(new Request(`${origin}/api/links${query}`, { headers: { cookie } }));

const markAllLinks =
  (handler: Handler) =>
  (cookie: string, requestOrigin = origin) =>
    handler(
      new Request(`${origin}/api/links/mark-all`, {
        method: 'POST',
        headers: {
          cookie,
          origin: requestOrigin,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })
    );

type LinkCall = (
  method: string,
  cookie: string,
  body?: object
) => Promise<Response>;
type CookieRequest = (cookie: string) => Promise<Response>;
type QueryRequest = (cookie: string, query: string) => Promise<Response>;
type MarkAllRequest = (
  cookie: string,
  requestOrigin?: string
) => Promise<Response>;

const verifyLinkCrud = async (
  call: LinkCall,
  unread: CookieRequest,
  alice: string,
  bob: string
) => {
  expect(
    (await call('POST', alice, { url: 'javascript:alert(1)' })).status
  ).toBe(400);
  const saved = await call('POST', alice, { url: 'http://127.0.0.1/article' });
  expect(saved.status).toBe(201);
  const item = await savedItem(saved);

  expect((await call('POST', alice, { url: item.url })).status).toBe(409);
  expect(await (await unread(alice)).json()).toEqual({ count: 1 });
  expect(await (await unread(bob)).json()).toEqual({ count: 0 });
  expect(await (await call('GET', bob)).json()).toEqual({
    items: [],
    hasMore: false,
  });
  expect((await call('PATCH', bob, { key: item.key, read: true })).status).toBe(
    404
  );
  expect((await call('DELETE', bob, { key: item.key })).status).toBe(404);
  expect(
    (await call('PATCH', alice, { key: item.key, read: true })).status
  ).toBe(200);
  expect(await (await unread(alice)).json()).toEqual({ count: 0 });
  expect(await (await call('GET', alice)).json()).toEqual({
    items: [],
    hasMore: false,
  });
  expect(
    (await call('PATCH', alice, { key: item.key, read: false })).status
  ).toBe(200);
  expect(await (await unread(alice)).json()).toEqual({ count: 1 });
  expect((await call('DELETE', alice, { key: item.key })).status).toBe(200);
  expect(await (await unread(alice)).json()).toEqual({ count: 0 });
};

const seedBulkLinks = async (call: LinkCall, alice: string, bob: string) => {
  for (const suffix of ['a', 'b', 'c']) {
    expect(
      (
        await call('POST', alice, {
          url: `http://127.0.0.1/bulk-${suffix}`,
        })
      ).status
    ).toBe(201);
  }

  expect(
    (await call('POST', bob, { url: 'http://127.0.0.1/bob-bulk' })).status
  ).toBe(201);
};

const verifyAllAndOffset = async (read: QueryRequest, alice: string) => {
  const allPage = (await (
    await read(alice, '?all=true&read=false')
  ).json()) as {
    items: { key: string; createdAt: string; read: boolean }[];
  };
  expect(allPage.items).toHaveLength(3);
  const expectedRest = allPage.items.slice(1).map(({ key }) => key);
  const newest = allPage.items[0];
  const cursorPage = (await (
    await read(
      alice,
      `?all=true&read=false&before=${encodeURIComponent(newest?.createdAt ?? '')}&beforeKey=${newest?.key ?? ''}`
    )
  ).json()) as { items: { key: string }[] };
  expect(cursorPage.items.map(({ key }) => key)).toEqual(expectedRest);
  const offsetPage = (await (
    await read(alice, '?all=true&read=false&offset=1')
  ).json()) as { items: { key: string }[] };
  expect(offsetPage.items.map(({ key }) => key)).toEqual(expectedRest);

  return allPage.items[1]?.key ?? '';
};

const verifyBulkScope = async (
  call: LinkCall,
  unread: CookieRequest,
  read: QueryRequest,
  markAll: MarkAllRequest,
  alice: string,
  bob: string,
  middle: string
) => {
  expect(await (await markAll(alice)).json()).toEqual({ ok: true });
  expect(await (await unread(alice)).json()).toEqual({ count: 0 });
  expect(await (await unread(bob)).json()).toEqual({ count: 1 });
  expect(
    (await call('PATCH', alice, { key: middle, read: false })).status
  ).toBe(200);
  expect(await (await unread(alice)).json()).toEqual({ count: 1 });
  expect(
    (
      (await (await read(alice, '?read=false')).json()) as {
        items: { key: string }[];
      }
    ).items.map(({ key }) => key)
  ).toEqual([middle]);
  const allItems = (await (
    await read(alice, '?all=true&read=false')
  ).json()) as { items: { read: boolean }[] };
  expect(allItems.items.some(({ read }) => read)).toBe(true);
  expect(allItems.items.some(({ read }) => !read)).toBe(true);
  expect(await (await markAll(bob)).json()).toEqual({ ok: true });
  expect(await (await unread(bob)).json()).toEqual({ count: 0 });
};

const verifyRoutes = async (handler: Handler) => {
  expect((await handler(new Request(`${origin}/api/links`))).status).toBe(401);
  expect(
    (await handler(new Request(`${origin}/api/links/unread-count`))).status
  ).toBe(401);
  expect(
    (
      await handler(
        new Request(`${origin}/api/links/mark-all`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
      )
    ).status
  ).toBe(401);
  const alice = await signIn(handler, 'alice@example.com');
  const bob = await signIn(handler, 'bob@example.com');
  await verifyCrossSite(handler, alice);
  const markAll = markAllLinks(handler);
  expect((await markAll(alice, 'https://untrusted.example')).status).toBe(403);

  await verifyLinkCrud(
    callLinks(handler),
    readUnreadCount(handler),
    alice,
    bob
  );
  await seedBulkLinks(callLinks(handler), alice, bob);
  const middle = await verifyAllAndOffset(readLinks(handler), alice);
  await verifyBulkScope(
    callLinks(handler),
    readUnreadCount(handler),
    readLinks(handler),
    markAll,
    alice,
    bob,
    middle
  );
};

it.effect('authenticates and isolates reading-list HTTP operations', () =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: 'route-links',
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

        await db.query(linksSchema);
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
          await verifyRoutes(handler);
        } finally {
          await dispose();
        }
      }),
    (db) => Effect.promise(() => db.close())
  )
);
