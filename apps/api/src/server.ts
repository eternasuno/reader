import { createServer } from 'node:http';
import {
  NodeFileSystem,
  NodeHttpPlatform,
  NodeHttpServer,
  NodePath,
  NodeRuntime,
} from '@effect/platform-node';
import { Config, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { AppLive } from './app';
import { AuthLive } from './infrastructure/auth';
import { DatabaseLive } from './infrastructure/db';
import { staticRoutes } from './routes/static';

const DEFAULT_PORT = 3001;

const server = NodeHttpServer.layerConfig(createServer, {
  port: Config.Port('API_PORT').pipe(Config.withDefault(DEFAULT_PORT)),
});

const dependencies = Layer.mergeAll(
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
