import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  createLibraryClient,
  type Feed,
  type Folder,
  FolderSchema,
  LibraryError,
} from '../../src/lib/library';

type RecordedRequest = {
  readonly method: string;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly body: unknown;
};

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

const makeClient = (handler: Handler) => {
  const requests: Array<RecordedRequest> = [];
  const client = createLibraryClient({
    baseUrl: 'http://api.test',
    fetch: async (input, init) => {
      const url = new URL(input);
      const request: RecordedRequest = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        params: url.searchParams,
        body:
          init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      requests.push(request);

      return handler(request);
    },
  });

  return { client, requests };
};

const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

const failure = async (task: Promise<unknown>): Promise<unknown> =>
  task.catch((caught: unknown) => caught);

const folder = (id: string, name = `Folder ${id}`): Folder => ({
  id,
  ownerId: 'owner',
  name,
});

const folderJson = (id: string, name = `Folder ${id}`) =>
  Schema.encodeUnknownSync(FolderSchema)(folder(id, name));

const feedJson = (folderId?: string): unknown => ({
  id: 'f1',
  ownerId: 'owner',
  url: 'https://example.com/f1.xml',
  title: 'Feed f1',
  ...(folderId === undefined ? {} : { folderId }),
});

const feed = (folderId?: string): Feed => ({
  id: 'f1',
  ownerId: 'owner',
  url: 'https://example.com/f1.xml',
  title: 'Feed f1',
  updatedAt: Option.none(),
  folderId: Option.fromUndefinedOr(folderId),
});

describe('library folder reads', () => {
  it('lists folder feed items without a feed filter', async () => {
    const { client, requests } = makeClient(json({ items: [], cursor: null }));

    await client.list({ kind: 'folder', folderId: 'folder-1' }, false);

    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.path).toBe('/api/library/feeds/items');
    expect(requests[0]?.params.get('folderId')).toBe('folder-1');
    expect(requests[0]?.params.get('feedId')).toBeNull();
    expect(requests[0]?.params.get('unreadOnly')).toBe('false');
  });

  it('lists folders from the folder endpoint', async () => {
    const { client, requests } = makeClient(
      json({ items: [folderJson('a'), folderJson('b', 'Read later')] })
    );

    expect(await client.folders()).toEqual([
      folder('a'),
      folder('b', 'Read later'),
    ]);
    expect(requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/library/folders',
    });
  });

  it('decodes feeds with and without a folder', async () => {
    const { client } = makeClient(
      json({ items: [feedJson(), feedJson('folder-1')] })
    );

    expect(await client.feeds()).toEqual([feed(), feed('folder-1')]);
  });
});

describe('library folder writes', () => {
  it('creates a folder with the name alone', async () => {
    const { client, requests } = makeClient(
      json({ item: folderJson('a', 'Reading') }, 201)
    );

    expect(await client.createFolder('Reading')).toEqual(
      folder('a', 'Reading')
    );
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/library/folders',
      body: { name: 'Reading' },
    });
  });

  it('renames and removes folders by id', async () => {
    const { client, requests } = makeClient(json({ ok: true }));

    await client.renameFolder('a', 'Renamed');
    await client.removeFolder('a');

    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/library/folders',
      body: { id: 'a', name: 'Renamed' },
    });
    expect(requests[1]).toMatchObject({
      method: 'DELETE',
      path: '/api/library/folders',
      body: { id: 'a' },
    });
  });

  it('moves a feed to a folder and back to the top level', async () => {
    const { client, requests } = makeClient(json({ ok: true }));

    await client.moveFeed('f1', 'folder-1');
    await client.moveFeed('f1', undefined);

    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/library/feeds',
      body: { id: 'f1', folderId: 'folder-1' },
    });
    expect(requests[1]).toMatchObject({
      method: 'PATCH',
      path: '/api/library/feeds',
      body: { id: 'f1', folderId: null },
    });
  });
});

describe('library folder read state', () => {
  it('marks folders read in one batch', async () => {
    const { client, requests } = makeClient(json({ ok: true }));

    await client.markFolders(['a', 'b']);

    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/library/folders/mark-read',
      body: { folderIds: ['a', 'b'] },
    });
  });
});

describe('library folder subscription writes', () => {
  it('subscribes at the top level and into a folder', async () => {
    const { client, requests } = makeClient(() =>
      Response.json({ item: feedJson() }, { status: 201 })
    );

    expect(
      await client.subscribe('https://example.com/f1.xml', 'Feed f1')
    ).toEqual(feed());
    expect(
      await client.subscribe(
        'https://example.com/f1.xml',
        'Feed f1',
        'folder-1'
      )
    ).toEqual(feed());
    expect(requests[0]?.body).toEqual({
      url: 'https://example.com/f1.xml',
      title: 'Feed f1',
    });
    expect(requests[1]?.body).toEqual({
      url: 'https://example.com/f1.xml',
      title: 'Feed f1',
      folderId: 'folder-1',
    });
  });
});

describe('library folder error tags', () => {
  it('keeps the folder id for a missing folder', async () => {
    const { client } = makeClient(
      json({ _tag: 'FolderNotFound', message: 'Missing', id: 'a' }, 404)
    );
    const error = await failure(client.removeFolder('a'));

    expect(error).toBeInstanceOf(LibraryError);
    expect(error).toMatchObject({
      tag: 'FolderNotFound',
      id: 'a',
      message: '目录不存在，可能已被删除',
    });
  });

  it('localizes duplicate folder names', async () => {
    const { client } = makeClient(
      json({ _tag: 'FolderAlreadyExists', message: 'Exists' }, 409)
    );

    expect(await failure(client.createFolder('Reading'))).toMatchObject({
      tag: 'FolderAlreadyExists',
      message: '该目录名称已存在',
    });
  });
});
