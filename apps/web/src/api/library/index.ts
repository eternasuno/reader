import { type LibraryClientOptions, makeRunner } from '../client';
import { readerMethods } from './read';
import { articleMethods, feedMethods, folderMethods } from './write';

export type { LibraryClientOptions } from '../client';
export * from '../errors';
export * from '../types';
export { refOf } from '../views';

export const createLibraryClient = (options: LibraryClientOptions = {}) => {
  const run = makeRunner(options);

  return {
    ...readerMethods(run),
    ...articleMethods(run),
    ...folderMethods(run),
    ...feedMethods(run),
  };
};

export type LibraryClient = ReturnType<typeof createLibraryClient>;

export const library: LibraryClient = createLibraryClient();
