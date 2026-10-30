import { expect, it } from '@effect/vitest';
import { FeedFetcher } from '@reader/business';
import { surrealAdapter } from '@surrealdb/better-auth';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { FeedPreviewStoreLive } from '../../src/adapter/feed-preview-store';
import { AppLive } from '../../src/app';
import { Auth } from '../../src/infrastructure/auth';
import { createSurreal, Database } from '../../src/infrastructure/db';
import { feedsSchema } from '../../src/infrastructure/feeds';

const origin = 'http://localhost:3000';
const previewUrl = 'https://example.com/preview.xml';

const fetchedFeed = {
  title: 'Preview News',
  description: 'Preview description',
  articles: [
    {
      identity: 'preview-one',
      url: 'https://example.com/preview-one',
      title: 'Preview One',
      publishedAt: '2026-10-17T00:00:00.000Z',
    },
  ],
};

const feedFetcher = Layer.succeed(FeedFetcher, {
  fetch: (url) => Effect.succeed({ ...fetchedFeed, url }),
});

type Handler = (request: Request) => Promise<Response>;
type Preview = {
  token: string;
  url: string;
  title: string;
  description: string;
  articleCount: number;
};
type FeedItem = {
  key: string;
  url: string;
  title: string;
  unreadCount: number;
};

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
  const payload = (await response.json()) as { user?: { id?: string } } | null;
  const id = payload?.user?.id;
  if (!id) {
    throw new Error('Missing session user');
  }

  return id;
};

const feedPost = (
  handler: Handler,
  cookie: string,
  path: string,
  body: unknown
) =>
  handler(
    new Request(`${origin}/api/feeds${path}`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

const feedItem = async (response: Response): Promise<FeedItem> => {
  const payload = (await response.json()) as { item: FeedItem };

  return payload.item;
};

const previewSubscription = async (
  handler: Handler,
  alice: string,
  bob: string
) => {
  expect(
    (await feedPost(handler, alice, '/preview', { url: 'not a url' })).status
  ).toBe(400);
  expect(
    (await feedPost(handler, alice, '', { token: 'unknown' })).status
  ).toBe(400);

  const response = await feedPost(handler, alice, '/preview', {
    url: previewUrl,
  });
  expect(response.status).toBe(200);
  const { preview } = (await response.json()) as { preview: Preview };
  expect(preview).toMatchObject({
    url: previewUrl,
    title: 'Preview News',
    description: 'Preview description',
    articleCount: 1,
  });

  expect(
    (await feedPost(handler, bob, '', { token: preview.token })).status
  ).toBe(400);

  const confirmed = await feedPost(handler, alice, '', {
    token: preview.token,
  });
  expect(confirmed.status).toBe(200);
  const item = await feedItem(confirmed);
  expect(item).toMatchObject({
    url: previewUrl,
    title: 'Preview News',
    unreadCount: 1,
  });

  const retried = await feedPost(handler, alice, '', { token: preview.token });
  expect(retried.status).toBe(200);
  expect(await feedItem(retried)).toEqual(item);

  return item;
};

const verifyPreviewContract = async (
  handler: Handler,
  db: Database['Service']
) => {
  const alice = await signIn(handler, 'preview-alice@example.com');
  const bob = await signIn(handler, 'preview-bob@example.com');
  const aliceId = await sessionUserId(handler, alice);

  const unauthenticated = await handler(
    new Request(`${origin}/api/feeds/preview`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ url: previewUrl }),
    })
  );
  expect(unauthenticated.status).toBe(401);

  const item = await previewSubscription(handler, alice, bob);

  const [feeds] = await db.query<[{ key: string }[]]>(
    'SELECT key FROM feed WHERE owner = $owner;',
    { owner: aliceId }
  );
  expect(feeds).toEqual([{ key: item.key }]);
  const [articles] = await db.query<[unknown[]]>(
    'SELECT key FROM feed_article WHERE owner = $owner AND feedKey = $feedKey;',
    { owner: aliceId, feedKey: item.key }
  );
  expect(articles).toHaveLength(1);
};

it.effect('previews and confirms through one store shared by requests', () =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      createSurreal({
        endpoint: 'mem://',
        namespace: 'route-feed-preview',
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
              FeedPreviewStoreLive,
              feedFetcher
            )
          )
        );
        const { handler, dispose } = HttpRouter.toWebHandler(routes, {
          disableLogger: true,
        });
        try {
          await verifyPreviewContract(handler, db);
        } finally {
          await dispose();
        }
      }),
    (db) => Effect.promise(() => db.close())
  )
);
