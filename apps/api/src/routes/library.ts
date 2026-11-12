import { LibraryApi } from '@reader/api';
import { Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { checkOrigin } from '../middleware/origin';
import { sessionMiddleware } from '../middleware/session';
import { feedHandlers } from './library-handlers-feed';
import { feedItemHandlers } from './library-handlers-feed-item';
import { folderHandlers } from './library-handlers-folder';
import { savedPageHandlers } from './library-handlers-saved-page';
import { settingsHandlers } from './library-handlers-settings';

const libraryHandlers = HttpApiBuilder.group(LibraryApi, 'library', (group) =>
  group.handleAll({
    ...savedPageHandlers,
    ...feedItemHandlers,
    ...feedHandlers,
    ...folderHandlers,
    ...settingsHandlers,
  })
);

export const libraryRoutes = HttpApiBuilder.layer(LibraryApi).pipe(
  Layer.provide(libraryHandlers),
  Layer.provide(checkOrigin.layer),
  Layer.provide(sessionMiddleware.layer),
  Layer.provide(HttpServer.layerServices)
);
