import { LibraryApi } from '@reader/api';
import { Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { OriginCheckLive } from '../middleware/origin';
import { AuthenticationLive } from '../middleware/session';
import { feedHandlers } from './feed';
import { feedItemHandlers } from './feed-item';
import { folderHandlers } from './folder';
import { savedPageHandlers } from './saved-page';
import { settingsHandlers } from './setting';

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
  Layer.provide(OriginCheckLive),
  Layer.provide(AuthenticationLive),
  Layer.provide(HttpServer.layerServices)
);
