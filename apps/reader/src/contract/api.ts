import { HttpApi } from 'effect/http-api';
import { FeedApi } from './feed';
import { FeedItemApi } from './feed-item';
import { FolderApi } from './folder';
import { Authentication } from './middleware';
import { SavedPageApi } from './saved-page';
import { SettingApi } from './setting';

/**
 * The contract shared by the server and the web client: every endpoint is under
 * `/api`, needs a session (so `Authentication` is applied to the whole API) and
 * declares its own `OriginCheck` when it changes state (reader-spec: API
 * conventions).
 */
export const ReaderApi = HttpApi.make('reader')
  .add(SavedPageApi, FeedApi, FeedItemApi, FolderApi, SettingApi)
  .middleware(Authentication)
  .prefix('/api');
