import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  call,
  readFailure,
  readFolder,
  readFolders,
  readJson,
  seedFolder,
  sessionFor,
} from './library-fixtures';
import { makeHarness } from './library-support';

const FOLDERS = '/api/library/folders';
const UNKNOWN_ID = '01234567-89ab-7cde-8123-456789abcdef';

it.effect('lists the folders of the signed-in owner by name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const alice = yield* sessionFor(harness, 'alice@example.com');
      const bob = yield* sessionFor(harness, 'bob@example.com');
      const tech = yield* seedFolder(harness, alice, 'Tech');
      const news = yield* seedFolder(harness, alice, 'News');
      yield* seedFolder(harness, bob, 'Private');

      const response = yield* call(harness, {
        path: FOLDERS,
        cookie: alice.cookie,
      });
      const folders = yield* Effect.promise(() => readFolders(response));

      expect(response.status).toBe(200);
      expect(folders.map((folder) => folder.id)).toEqual([news.id, tech.id]);
      expect(folders.map((folder) => folder.name)).toEqual(['News', 'Tech']);
      expect(folders.every((folder) => folder.ownerId === alice.owner)).toBe(
        true
      );
    })
  )
);

it.effect('creates a folder with a trimmed name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: FOLDERS,
        cookie: session.cookie,
        body: { name: '  Tech  ' },
      });
      const folder = yield* Effect.promise(() => readFolder(response));

      expect(response.status).toBe(201);
      expect(folder.name).toBe('Tech');
      expect(folder.ownerId).toBe(session.owner);
    })
  )
);

it.effect('rejects a blank folder name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: FOLDERS,
        cookie: session.cookie,
        body: { name: '   ' },
      });

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidFolderName',
        message: '请输入目录名称',
      });
    })
  )
);

it.effect('rejects a duplicate folder name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      yield* seedFolder(harness, session, 'Tech');

      const response = yield* call(harness, {
        method: 'POST',
        path: FOLDERS,
        cookie: session.cookie,
        body: { name: 'Tech' },
      });

      expect(response.status).toBe(409);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FolderAlreadyExists',
        message: '该目录名称已存在',
      });
    })
  )
);

it.effect('creates folders whose names differ only in case', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const first = yield* call(harness, {
        method: 'POST',
        path: FOLDERS,
        cookie: session.cookie,
        body: { name: 'Tech' },
      });
      const second = yield* call(harness, {
        method: 'POST',
        path: FOLDERS,
        cookie: session.cookie,
        body: { name: 'tech' },
      });
      const listed = yield* call(harness, {
        path: FOLDERS,
        cookie: session.cookie,
      });
      const folders = yield* Effect.promise(() => readFolders(listed));

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(folders.map((folder) => folder.name)).toEqual(['Tech', 'tech']);
    })
  )
);

it.effect('renames a folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');

      const response = yield* call(harness, {
        method: 'PATCH',
        path: FOLDERS,
        cookie: session.cookie,
        body: { id: folder.id, name: ' Engineering ' },
      });
      const listed = yield* call(harness, {
        path: FOLDERS,
        cookie: session.cookie,
      });
      const folders = yield* Effect.promise(() => readFolders(listed));

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => readJson(response))).toEqual({
        ok: true,
      });
      expect(folders.map((item) => item.name)).toEqual(['Engineering']);
      expect(folders.map((item) => item.id)).toEqual([folder.id]);
    })
  )
);

it.effect('rejects renaming a folder to a taken name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');
      yield* seedFolder(harness, session, 'News');

      const response = yield* call(harness, {
        method: 'PATCH',
        path: FOLDERS,
        cookie: session.cookie,
        body: { id: folder.id, name: 'News' },
      });

      expect(response.status).toBe(409);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FolderAlreadyExists',
        message: '该目录名称已存在',
      });
    })
  )
);

it.effect('rejects renaming an unknown folder', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'PATCH',
        path: FOLDERS,
        cookie: session.cookie,
        body: { id: UNKNOWN_ID, name: 'Tech' },
      });

      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'FolderNotFound',
        message: '目录不存在，可能已被删除',
        id: UNKNOWN_ID,
      });
    })
  )
);

it.effect('rejects renaming a folder to a blank name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');
      const folder = yield* seedFolder(harness, session, 'Tech');

      const response = yield* call(harness, {
        method: 'PATCH',
        path: FOLDERS,
        cookie: session.cookie,
        body: { id: folder.id, name: ' ' },
      });
      const listed = yield* call(harness, {
        path: FOLDERS,
        cookie: session.cookie,
      });
      const folders = yield* Effect.promise(() => readFolders(listed));

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => readFailure(response))).toEqual({
        _tag: 'InvalidFolderName',
        message: '请输入目录名称',
      });
      expect(folders.map((item) => item.name)).toEqual(['Tech']);
    })
  )
);
