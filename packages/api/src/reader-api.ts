import { HttpApi, HttpApiGroup } from 'effect/http-api';
import { feedEndpoints } from './feed';
import { feedItemEndpoints } from './feed-item';
import { folderEndpoints } from './folder';
import { Authentication } from './middleware';
import { savedPageEndpoints } from './saved-page';
import { settingEndpoints } from './setting';

const library = HttpApiGroup.make('library')
  .add(...savedPageEndpoints)
  .add(...feedEndpoints)
  .add(...feedItemEndpoints)
  .add(...folderEndpoints)
  .add(...settingEndpoints)
  .middleware(Authentication);

export const LibraryApi = HttpApi.make('library').add(library);
