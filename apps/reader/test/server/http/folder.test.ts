import { expect, it } from '@effect/vitest';
import {
  FeedItemRepository,
  FeedRepository,
  FolderName,
  FolderRepository,
} from '@reader/business';
import {
  alice,
  makeUniqueFeed,
  makeUniqueFeedItem,
  makeUniqueFolder,
} from '@reader/business/testing';
import { Effect, Option } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { ReaderApi } from '../../../src/contract';
import { httpLayer } from './support';

const client = () => HttpApiTest.groups(ReaderApi, ['folder']);

const seedFolder = (name = 'Folder') =>
  Effect.gen(function* () {
    const folders = yield* FolderRepository;
    const folder = makeUniqueFolder({ name: FolderName.make(name) });
    yield* folders.create(alice, [folder]);

    return folder;
  });

const seedFolderWithItem = () =>
  Effect.gen(function* () {
    const folder = yield* seedFolder();
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed({ folderId: Option.some(folder.id) });
    yield* feeds.create(alice, [feed]);
    const items = yield* FeedItemRepository;
    const item = makeUniqueFeedItem({ feedId: feed.id });
    yield* items.create(alice, [item]);

    return { folder, feed, item };
  });

it.effect('GET /api/folders FD-FOLDER-8 orders folders by name', () =>
  Effect.gen(function* () {
    const beta = yield* seedFolder('Beta');
    const alpha = yield* seedFolder('Alpha');
    const api = yield* client();
    const body = yield* api.folder.listFolders();

    expect(body.items.map((folder) => folder.id)).toEqual([alpha.id, beta.id]);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/folders FD-FOLDER-4 trims and creates the name', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const body = yield* api.folder.createFolder({
      payload: { name: '  Reading  ' },
    });

    expect(body.item.name).toBe('Reading');
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/folders FD-FOLDER-2 rejects a blank name', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const response = yield* api.folder.createFolder({
      payload: { name: '   ' },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(400);
    expect(yield* response.json).toEqual({ _tag: 'InvalidFolderName' });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/folders FD-FOLDER-4 answers 409 for a taken name', () =>
  Effect.gen(function* () {
    const folder = yield* seedFolder('Reading');
    const api = yield* client();
    const response = yield* api.folder.createFolder({
      payload: { name: folder.name },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(409);
    expect(yield* response.json).toEqual({ _tag: 'FolderAlreadyExists' });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('PATCH /api/folders/:id FD-FOLDER-5 renames the folder', () =>
  Effect.gen(function* () {
    const folder = yield* seedFolder();
    const api = yield* client();
    const response = yield* api.folder.renameFolder({
      params: { id: folder.id },
      payload: { name: 'Renamed' },
      responseMode: 'response-only',
    });
    const folders = yield* FolderRepository;
    const stored = yield* folders.find(alice, folder.id);

    expect(response.status).toBe(204);
    expect(Option.getOrNull(stored)?.name).toBe('Renamed');
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('PATCH /api/folders/:id FD-FOLDER-5 answers FolderNotFound', () =>
  Effect.gen(function* () {
    const missing = makeUniqueFolder();
    const api = yield* client();
    const response = yield* api.folder.renameFolder({
      params: { id: missing.id },
      payload: { name: 'Renamed' },
      responseMode: 'response-only',
    });

    expect(response.status).toBe(404);
    expect(yield* response.json).toEqual({
      _tag: 'FolderNotFound',
      id: missing.id,
    });
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('DELETE /api/folders/:id FD-FOLDER-7 removes its feeds too', () =>
  Effect.gen(function* () {
    const { folder, feed } = yield* seedFolderWithItem();
    const api = yield* client();
    const response = yield* api.folder.removeFolder({
      params: { id: folder.id },
      responseMode: 'response-only',
    });
    const feeds = yield* FeedRepository;
    const remaining = yield* feeds.find(alice, feed.id);

    expect(response.status).toBe(204);
    expect(Option.isNone(remaining)).toBe(true);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('POST /api/folders/:id/read-all FD-READ-5 marks folder items', () =>
  Effect.gen(function* () {
    const { folder } = yield* seedFolderWithItem();
    const api = yield* client();
    const response = yield* api.folder.markFolderRead({
      params: { id: folder.id },
      responseMode: 'response-only',
    });
    const items = yield* FeedItemRepository;
    const unreadItems = yield* items.listByFolder(alice, folder.id, {
      limit: 10,
      unread: true,
      cursor: Option.none(),
    });

    expect(response.status).toBe(204);
    expect(unreadItems).toEqual([]);
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('GET /api/folders/:id/items FD-LIST-6 pages the folder', () =>
  Effect.gen(function* () {
    const { folder, item } = yield* seedFolderWithItem();
    const api = yield* client();
    const body = yield* api.folder.listFolderItems({
      params: { id: folder.id },
      query: { limit: 10, unread: false },
    });

    expect(body.items.map((row) => row.id)).toEqual([item.id]);
    expect(body.cursor).toBeNull();
  }).pipe(Effect.provide(httpLayer()))
);

it.effect('GET /api/folders/:id/items FD-LIST-7 unknowns are empty', () =>
  Effect.gen(function* () {
    const missing = makeUniqueFolder();
    const api = yield* client();
    const body = yield* api.folder.listFolderItems({
      params: { id: missing.id },
      query: { limit: 10, unread: false },
    });

    expect(body).toEqual({ items: [], cursor: null });
  }).pipe(Effect.provide(httpLayer()))
);
