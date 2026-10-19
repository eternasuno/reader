import { expect, it } from '@effect/vitest';
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

const verifyRoutes = async (handler: Handler) => {
  expect((await handler(new Request(`${origin}/api/links`))).status).toBe(401);
  const alice = await signIn(handler, 'alice@example.com');
  const bob = await signIn(handler, 'bob@example.com');
  await verifyCrossSite(handler, alice);

  const call = (method: string, cookie: string, body?: object) =>
    handler(
      new Request('http://localhost:3001/api/links', {
        method,
        headers: { cookie, origin, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
  expect(
    (await call('POST', alice, { url: 'javascript:alert(1)' })).status
  ).toBe(400);
  const saved = await call('POST', alice, { url: 'http://127.0.0.1/article' });
  expect(saved.status).toBe(201);
  const item = await savedItem(saved);

  expect((await call('POST', alice, { url: item.url })).status).toBe(409);
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
  expect(await (await call('GET', alice)).json()).toEqual({
    items: [],
    hasMore: false,
  });
  expect((await call('DELETE', alice, { key: item.key })).status).toBe(200);
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
              Layer.succeed(Database, db)
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
