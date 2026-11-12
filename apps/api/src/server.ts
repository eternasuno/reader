import { createServer } from 'node:http';
import {
  NodeFileSystem,
  NodeHttpPlatform,
  NodeHttpServer,
  NodePath,
  NodeRuntime,
} from '@effect/platform-node';
import { refreshFeed } from '@reader/business';
import { Config, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { AppLive, LibraryServicesLive } from './app';
import { AuthLive } from './infrastructure/auth';
import { DatabaseLive } from './infrastructure/db';
import { feedRefreshQueueLayer } from './infrastructure/feed-refresh-queue';
import {
  FEED_REFRESH_INTERVAL,
  feedRefreshSchedulerLayer,
} from './infrastructure/feed-refresh-scheduler';
import { staticRoutes } from './routes/static';

const DEFAULT_PORT = 3001;

const server = NodeHttpServer.layerConfig(createServer, {
  port: Config.Port('API_PORT').pipe(Config.withDefault(DEFAULT_PORT)),
});

const library = LibraryServicesLive.pipe(Layer.provide(DatabaseLive));

const queue = feedRefreshQueueLayer({ refresh: refreshFeed }).pipe(
  Layer.provide(library)
);

const scheduler = feedRefreshSchedulerLayer({
  interval: FEED_REFRESH_INTERVAL,
}).pipe(Layer.provide(Layer.merge(DatabaseLive, queue)));

const dependencies = Layer.mergeAll(
  library,
  queue,
  scheduler,
  AuthLive.pipe(Layer.provide(DatabaseLive)),
  NodeFileSystem.layer,
  NodePath.layer,
  NodeHttpPlatform.layer
);

const routes = Layer.mergeAll(AppLive, staticRoutes);

const main = routes.pipe(
  Layer.provide(dependencies),
  HttpRouter.serve,
  Layer.provide(server),
  Layer.launch
);

NodeRuntime.runMain(main);
