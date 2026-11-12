import { HttpApi, HttpApiGroup } from 'effect/http-api';
import { feedEndpoints } from './feeds';
import { savedPageEndpoints } from './saved-pages';
import { settingEndpoints } from './settings';

const library = HttpApiGroup.make('library')
  .add(...savedPageEndpoints)
  .add(...feedEndpoints)
  .add(...settingEndpoints);

export const LibraryApi = HttpApi.make('library').add(library);
