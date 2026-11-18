import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import * as NodeHttpPlatform from '@effect/platform-node/NodeHttpPlatform';
import * as NodePath from '@effect/platform-node/NodePath';
import type {
  ArticleExtractor,
  DocumentSanitizer,
  FeedItemRepository,
  FeedParser,
  FeedRepository,
  FolderRepository,
  HtmlParser,
  SavedPageRepository,
  SettingRepository,
} from '@reader/business';
import { ContentLive } from '@reader/content';
import { readerStoreDatabaseLayer } from '@reader/sqlite/testing';
import { Effect, Layer } from 'effect';
import { Etag, FetchHttpClient, HttpRouter } from 'effect/http';
import {
  type HttpApi,
  HttpApiBuilder,
  type HttpApiGroup,
} from 'effect/http-api';
import type { SqlClient } from 'effect/sql';
import { ReaderApi } from '../../../src/contract';
import { type Auth, AuthRoutesLive } from '../../../src/server/auth';
import type { ServerConfig } from '../../../src/server/config';
import {
  AuthenticationLive,
  OriginCheckLive,
} from '../../../src/server/http/middleware';
import type { FeedRefreshQueue } from '../../../src/server/refresh/queue';
import { FeedRefreshQueueLive } from '../../../src/server/refresh/queue-live';
import {
  type MemoryAuth,
  makeMemoryAuth,
  TEST_ORIGIN,
  TestConfigLive,
} from './auth';

const PASSWORD = 'test-password-123';

type ReaderGroups =
  typeof ReaderApi extends HttpApi.HttpApi<infer _Id, infer Groups>
    ? Groups
    : never;

/** The group services a handler layer provides to the contract. */
export type ReaderHandlers = HttpApiGroup.ToService<'reader', ReaderGroups>;

/** Everything the test server provides to the routes it runs. */
export type TestServices =
  | SqlClient.SqlClient
  | FeedRepository
  | FeedItemRepository
  | FolderRepository
  | SavedPageRepository
  | SettingRepository
  | FeedParser
  | HtmlParser
  | ArticleExtractor
  | DocumentSanitizer
  | FeedRefreshQueue
  | Auth
  | ServerConfig;

/** A request the test server answers; `origin: null` sends no `Origin`. */
export type TestRequest = {
  readonly method?: string;
  readonly path: string;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly origin?: string | null;
  readonly headers?: Record<string, string>;
};

export type TestApp = {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
  readonly auth: MemoryAuth['auth'];
  /** Signs a fresh account up and in; answers its cookie and Better Auth id. */
  readonly signIn: (
    email?: string
  ) => Promise<{ readonly cookie: string; readonly userId: string }>;
};

/** Builds the `Request` a test sends to the server. */
export const testRequest = (options: TestRequest): Request =>
  new Request(new URL(options.path, TEST_ORIGIN), {
    method: options.method ?? 'GET',
    headers: {
      ...(options.origin === null
        ? {}
        : { origin: options.origin ?? TEST_ORIGIN }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });

const testDependencies = (memory: MemoryAuth) =>
  Layer.mergeAll(
    TestConfigLive,
    memory.layer,
    readerStoreDatabaseLayer,
    ContentLive,
    FetchHttpClient.layer,
    FeedRefreshQueueLive(() => Effect.void),
    Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
    NodeHttpPlatform.layer,
    Etag.layer
  );

const signIn =
  (
    handler: (request: Request) => Promise<Response>,
    auth: MemoryAuth['auth']
  ) =>
  async (email = 'reader@example.com') => {
    const credentials = { name: 'Reader', email, password: PASSWORD };

    await handler(
      testRequest({
        method: 'POST',
        path: '/api/auth/sign-up/email',
        body: credentials,
      })
    );
    const response = await handler(
      testRequest({
        method: 'POST',
        path: '/api/auth/sign-in/email',
        body: credentials,
      })
    );

    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .join('; ');
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
      returnHeaders: true,
    });
    const userId = session.response?.user.id;

    if (userId === undefined) {
      throw new Error(`Sign-in answered ${response.status} without a session`);
    }

    return { cookie, userId };
  };

/**
 * Runs the given routes over in-memory databases: the handler layer's services
 * come from `@reader/sqlite/testing` and the content adapters, Better Auth has
 * its migrations applied to a `:memory:` database, and the dependencies are
 * provided both to the layer and to the per-request context the router builds.
 */
export const makeTestServer = <A, E, R>(
  routes: Layer.Layer<A, E, R>,
  memory: MemoryAuth
): TestApp => {
  const dependencies = testDependencies(memory);
  // The routes type their requirements as one marker union per endpoint, which
  // the layer types cannot subtract member by member; `dependencies` satisfies
  // every one of them, so the provisioned layer is stated once here.
  const provided = routes.pipe(
    HttpRouter.provideRequest(dependencies),
    Layer.provide(dependencies)
  ) as unknown as Layer.Layer<never, unknown, never>;
  const web = HttpRouter.toWebHandler(provided, { disableLogger: true });

  return {
    handler: web.handler,
    dispose: web.dispose,
    auth: memory.auth,
    signIn: signIn(web.handler, memory.auth),
  };
};

/** Wraps a handler layer into the test app, with Better Auth's route mounted. */
export const makeTestApp = async (
  handlers: Layer.Layer<ReaderHandlers, never, TestServices>,
  options: { readonly auth?: MemoryAuth } = {}
): Promise<TestApp> => {
  const memory = options.auth ?? (await makeMemoryAuth());
  const routes = Layer.mergeAll(
    HttpApiBuilder.layer(ReaderApi).pipe(
      Layer.provide(handlers),
      Layer.provide(Layer.mergeAll(AuthenticationLive, OriginCheckLive))
    ),
    AuthRoutesLive
  );

  return makeTestServer(routes, memory);
};
