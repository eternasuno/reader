import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { refreshFeed } from '@reader/business';
import { ContentLive } from '@reader/content';
import {
  FeedItemRepositoryLive,
  FeedRepositoryLive,
  FolderRepositoryLive,
  readerClientLayer,
  SavedPageRepositoryLive,
  SettingRepositoryLive,
} from '@reader/sqlite';
import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { ReaderApi } from '../contract';
import { AuthLive, AuthRoutesLive } from './auth';
import { ServerConfig, ServerConfigLive } from './config';
import { ReaderHandlersLive } from './http';
import { AuthenticationLive, OriginCheckLive } from './http/middleware';
import { KindleSchedulerLive } from './kindle/scheduler';
import { KindleSenderLive } from './kindle/sender-live';
import { FeedRefreshQueueLive } from './refresh/queue-live';
import { RefreshSchedulerLive } from './refresh/scheduler';
import { StaticRoutesLive } from './static';

/** What every refresh and extraction runs on. */
const adapters = Layer.merge(ContentLive, FetchHttpClient.layer);

const repositories = Layer.mergeAll(
  FeedRepositoryLive,
  FeedItemRepositoryLive,
  FolderRepositoryLive,
  SavedPageRepositoryLive,
  SettingRepositoryLive
);

/**
 * Every dependency, built once over `<DATA_DIR>` (reader-engineering: Server >
 * Composition): the directory, the reader connection and its repositories, the
 * content adapters and HTTP client, Better Auth over `auth.db`, the refresh
 * queue and its scheduler, the Kindle sender and its scheduler. A single
 * `store` instance is shared, so one connection serves the routes, the queue,
 * the sends and both schedulers.
 */
const dependencies = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    yield* Effect.promise(() => mkdir(config.dataDir, { recursive: true }));

    const store = repositories.pipe(
      Layer.provideMerge(readerClientLayer(join(config.dataDir, 'reader.db')))
    );
    const queue = FeedRefreshQueueLive(refreshFeed).pipe(
      Layer.provide(Layer.merge(store, adapters))
    );
    const scheduler = RefreshSchedulerLive.pipe(
      Layer.provide(Layer.merge(store, queue))
    );
    const kindleSender = KindleSenderLive.pipe(
      Layer.provide(Layer.merge(store, adapters))
    );
    const kindleScheduler = KindleSchedulerLive.pipe(
      Layer.provide(Layer.merge(store, kindleSender))
    );

    return Layer.mergeAll(
      store,
      adapters,
      AuthLive,
      queue,
      scheduler,
      kindleSender,
      kindleScheduler
    );
  })
);

/**
 * The routes: the contract's endpoints with their handlers and the two
 * middleware implementations, Better Auth's own `/api/auth/*` and the static
 * assets.
 */
const api = HttpApiBuilder.layer(ReaderApi).pipe(
  Layer.provide(ReaderHandlersLive),
  Layer.provide(Layer.mergeAll(AuthenticationLive, OriginCheckLive))
);

const routes = Layer.mergeAll(api, AuthRoutesLive, StaticRoutesLive);

const httpServer = Layer.unwrap(
  Effect.map(ServerConfig, (config) =>
    NodeHttpServer.layer(createServer, { port: config.port })
  )
);

/**
 * The dependencies are provided outside `serve`, so one reader connection and
 * one queue serve the routes, the queue's refreshes and the scheduler.
 */
const program = routes.pipe(
  HttpRouter.serve,
  Layer.provide(Layer.merge(dependencies, httpServer)),
  Layer.launch
);

NodeRuntime.runMain(program.pipe(Effect.provide(ServerConfigLive)));
