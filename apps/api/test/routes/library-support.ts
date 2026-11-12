import {
  ArticleExtractor,
  type FeedId,
  FeedItemRepository,
  FeedParser,
  type FeedParserError,
  FeedRepository,
  type IArticleExtractor,
  makeFeedTitle,
  OwnerId,
  type ParsedFeed,
  SavedPageRepository,
  SettingRepository,
} from '@reader/business';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { Effect, Layer, Option, type Scope, Semaphore } from 'effect';
import { FetchHttpClient, HttpClient, HttpRouter } from 'effect/http';
import type { Surreal } from 'surrealdb';
import { vi } from 'vitest';
import { makeFeedItems } from '../../src/adapter/feed-item-store';
import { makeFeedRepository } from '../../src/adapter/feed-store';
import { makeSavedPages } from '../../src/adapter/saved-page-store';
import { makeSettings } from '../../src/adapter/setting-repository';
import { AppLive, LibraryServicesLive } from '../../src/app';
import { Auth } from '../../src/infrastructure/auth';
import { Database } from '../../src/infrastructure/db';
import {
  FeedRefreshQueue,
  type IFeedRefreshQueue,
} from '../../src/infrastructure/feed-refresh-queue';
import { authOptions, openDatabase, TEST_ORIGIN } from './library-database';
import {
  asEffect,
  defaultArticle,
  type FeedStub,
  feedClient,
  type WebpageStub,
  webpageFetch,
} from './library-network-stubs';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

const TEST_PASSWORD = 'test-password-123';

export type ParsedFeedStub = (
  baseUrl: URL
) => ParsedFeed | Effect.Effect<ParsedFeed, FeedParserError>;

export type HarnessStubs = {
  webpage: WebpageStub;
  feed: FeedStub;
  parsedFeed: ParsedFeedStub;
  articleExtractor: IArticleExtractor | undefined;
};

export type HarnessRepositories = {
  readonly feed: ReturnType<typeof makeFeedRepository>;
  readonly feedItem: ReturnType<typeof makeFeedItems>;
  readonly savedPage: ReturnType<typeof makeSavedPages>;
  readonly setting: ReturnType<typeof makeSettings>;
};

export type EnqueuedFeed = {
  readonly owner: OwnerId;
  readonly feedId: FeedId;
};

export type TestSession = {
  readonly email: string;
  readonly cookie: string;
  readonly owner: OwnerId;
};

export type CallOptions = {
  readonly method?: string;
  readonly path: string;
  readonly query?: Record<string, string | number | boolean>;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly origin?: string;
};

/**
 * Runs the real library routes (session middleware, origin check, HTTP
 * contract) over a fresh `mem://` database.
 *
 * `stubs` may be reassigned at any time to control the webpage transport (the
 * target URL, with the Jina prefix removed), the feed response and the parsed
 * feed. `repositories` are the same store instances the routes use, so a test
 * can arrange rows through them and may replace a method to inject a failure.
 */
export type Harness = {
  readonly db: Surreal;
  readonly auth: ReturnType<typeof betterAuth>;
  readonly handler: (request: Request) => Promise<Response>;
  readonly repositories: HarnessRepositories;
  readonly stubs: HarnessStubs;
  readonly enqueued: Array<EnqueuedFeed>;
  readonly signIn: (email: string) => Promise<TestSession>;
  readonly call: (options: CallOptions) => Promise<Response>;
  readonly json: <A>(response: Response) => Promise<A>;
};

const emptyParsedFeed = (baseUrl: URL): ParsedFeed => ({
  title: makeFeedTitle('Example feed', baseUrl),
  description: Option.none(),
  entries: [],
});

const feedParser = (stubs: HarnessStubs) => ({
  parse: (_content: string, baseUrl: URL) =>
    asEffect(stubs.parsedFeed(baseUrl)),
});

const recordingQueue = (enqueued: Array<EnqueuedFeed>): IFeedRefreshQueue => ({
  enqueue: (owner, feedId) =>
    Effect.sync(() => {
      enqueued.push({ owner, feedId });
    }),
});

const buildServices = (
  db: Surreal,
  repositories: HarnessRepositories,
  stubs: HarnessStubs,
  enqueued: Array<EnqueuedFeed>
) =>
  Layer.mergeAll(
    LibraryServicesLive,
    Layer.succeed(FeedRepository, repositories.feed),
    Layer.succeed(FeedItemRepository, repositories.feedItem),
    Layer.succeed(SavedPageRepository, repositories.savedPage),
    Layer.succeed(SettingRepository, repositories.setting),
    Layer.succeed(FeedRefreshQueue, recordingQueue(enqueued)),
    Layer.succeed(
      FetchHttpClient.Fetch,
      webpageFetch((url) => stubs.webpage(url))
    ),
    Layer.succeed(
      HttpClient.HttpClient,
      feedClient((url) => stubs.feed(url))
    ),
    Layer.succeed(FeedParser, feedParser(stubs)),
    stubs.articleExtractor === undefined
      ? Layer.empty
      : Layer.succeed(ArticleExtractor, stubs.articleExtractor)
  ).pipe(Layer.provide(Layer.succeed(Database, db)));

const buildApp = (
  db: Surreal,
  auth: ReturnType<typeof betterAuth>,
  repositories: HarnessRepositories,
  stubs: HarnessStubs,
  enqueued: Array<EnqueuedFeed>
) =>
  AppLive.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(Auth, auth),
        buildServices(db, repositories, stubs, enqueued)
      )
    )
  );

const emailRequest = (path: string, email: string) =>
  new Request(`${TEST_ORIGIN}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: TEST_ORIGIN },
    body: JSON.stringify({
      name: 'Reader',
      email,
      password: TEST_PASSWORD,
    }),
  });

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

const signIn =
  (
    handler: (request: Request) => Promise<Response>,
    auth: ReturnType<typeof betterAuth>
  ) =>
  async (email: string): Promise<TestSession> => {
    await handler(emailRequest('sign-up/email', email));
    const response = await handler(emailRequest('sign-in/email', email));

    if (response.status !== 200) {
      throw new Error(`Sign-in failed with status ${response.status}`);
    }

    const cookie = cookieOf(response);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
      returnHeaders: true,
    });
    const id = session.response?.user.id;

    if (id === undefined) {
      throw new Error('Signed-in session is missing');
    }

    return { email, cookie, owner: OwnerId.make(id) };
  };

const requestUrl = (options: CallOptions) => {
  const url = new URL(options.path, TEST_ORIGIN);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }

  return url;
};

const call =
  (handler: (request: Request) => Promise<Response>) =>
  (options: CallOptions) =>
    handler(
      new Request(requestUrl(options), {
        method: options.method ?? 'GET',
        headers: {
          origin: options.origin ?? TEST_ORIGIN,
          ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
          ...(options.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      })
    );

export type HarnessOptions = {
  readonly webpage?: WebpageStub;
  readonly feed?: FeedStub;
  readonly parsedFeed?: ParsedFeedStub;
  readonly articleExtractor?: IArticleExtractor;
};

export const makeHarness = (
  options: HarnessOptions = {}
): Effect.Effect<Harness, never, Scope.Scope> =>
  Effect.gen(function* () {
    const db = yield* openDatabase;
    const auth = betterAuth<BetterAuthOptions>(authOptions(db));
    const lock = yield* Semaphore.make(1);
    const stubs: HarnessStubs = {
      webpage: options.webpage ?? (() => defaultArticle()),
      feed:
        options.feed ?? ((url) => ({ content: '<rss version="2.0"/>', url })),
      parsedFeed: options.parsedFeed ?? emptyParsedFeed,
      articleExtractor: options.articleExtractor,
    };
    const enqueued: Array<EnqueuedFeed> = [];
    const repositories: HarnessRepositories = {
      feed: makeFeedRepository(db, lock),
      feedItem: makeFeedItems(db, lock),
      savedPage: makeSavedPages(db, lock),
      setting: makeSettings(db),
    };
    const app = buildApp(db, auth, repositories, stubs, enqueued);
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });

    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));

    return {
      db,
      auth,
      handler: web.handler,
      repositories,
      stubs,
      enqueued,
      signIn: signIn(web.handler, auth),
      call: call(web.handler),
      json: <A>(response: Response) => response.json() as Promise<A>,
    };
  });
