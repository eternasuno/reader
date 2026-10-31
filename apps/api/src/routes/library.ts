import { LibraryApi } from '@reader/api';
import { Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { checkOrigin } from '../middleware/origin';
import { sessionMiddleware } from '../middleware/session';
import { articleHandlers } from './library-handlers-article';
import { feedHandlers } from './library-handlers-feed';
import { settingsHandlers } from './library-handlers-settings';

export const libraryHandlers = HttpApiBuilder.group(
  LibraryApi,
  'library',
  (group) =>
    group.handleAll({
      ...articleHandlers,
      ...feedHandlers,
      ...settingsHandlers,
    })
);

export const libraryRoutes = HttpApiBuilder.layer(LibraryApi).pipe(
  Layer.provide(libraryHandlers),
  Layer.provide(checkOrigin.layer),
  Layer.provide(sessionMiddleware.layer),
  Layer.provide(HttpServer.layerServices)
);
