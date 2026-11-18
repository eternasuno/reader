import type { Feed } from '../../../src/web/feed/list';
import type { Folder } from '../../../src/web/folder/list';

/** Fixtures for the feed and folder web tests in the plain wire form `api/` returns. */

export const feedFixture = (
  id: string,
  title: string,
  folderId?: string,
  url = `https://example.com/${id}.xml`
): Feed => ({
  id,
  ownerId: 'owner-1',
  url,
  title,
  ...(folderId === undefined ? {} : { folderId }),
  readerMode: 'default',
  order: 'newest',
});

export const folderFixture = (id: string, name: string): Folder => ({
  id,
  ownerId: 'owner-1',
  name,
});
