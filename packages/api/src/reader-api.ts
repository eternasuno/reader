import { HttpApi, HttpApiGroup } from 'effect/http-api';
import { feedEndpoints } from './feeds';
import { folderEndpoints } from './folders';
import { Authentication } from './middleware';
import { savedPageEndpoints } from './saved-pages';
import { settingEndpoints } from './settings';

const library = HttpApiGroup.make('library')
  .add(...savedPageEndpoints)
  .add(...feedEndpoints)
  .add(...folderEndpoints)
  .add(...settingEndpoints)
  .middleware(Authentication);

export const LibraryApi = HttpApi.make('library').add(library);
