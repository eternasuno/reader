import {
  Folder,
  type FolderId,
  type FolderName,
  FolderRepository,
  type OwnerId,
} from '@reader/business';
import { Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import {
  createRows,
  folderRepositoryError,
  readRows,
  recordsOf,
  run,
  write,
} from './sql';

const COLUMNS = 'folderId AS id, owner AS ownerId, name';

const encodeFolder = Schema.encodeSync(Folder);

const toRecord = (id: FolderId) => new RecordId('folder', id);

const findFolder = (db: Surreal, owner: OwnerId, id: FolderId) =>
  readRows(
    db,
    `SELECT ${COLUMNS} FROM folder WHERE owner = $owner AND id = $record;`,
    { owner, record: toRecord(id) },
    Folder,
    folderRepositoryError
  ).pipe(Effect.map((folders) => Option.fromUndefinedOr(folders[0])));

const listFolders = (db: Surreal, owner: OwnerId) =>
  readRows(
    db,
    `SELECT ${COLUMNS} FROM folder WHERE owner = $owner ORDER BY name ASC, folderId ASC;`,
    { owner },
    Folder,
    folderRepositoryError
  );

const insertStatement = (row: string, index: number) => `
LET $n${index} = SELECT VALUE folderId FROM folder WHERE owner = $owner AND name = ${row}.name;
LET $e${index} = SELECT VALUE id FROM folder WHERE id = type::record("folder", ${row}.id);
LET $r${index} = IF array::len($n${index}) = 0 AND array::len($e${index}) = 0 { CREATE type::record("folder", ${row}.id) SET owner = $owner, folderId = ${row}.id, name = ${row}.name } ELSE { [] };
LET $created = array::append($created, array::len($r${index}) > 0);`;

const createFolders = (
  db: Surreal,
  owner: OwnerId,
  folders: ReadonlyArray<Folder>
) =>
  createRows(db, owner, folders, {
    prefix: 'd',
    encode: encodeFolder,
    statement: insertStatement,
    onError: folderRepositoryError,
  });

const RENAME = `BEGIN TRANSACTION;
LET $taken = SELECT VALUE id FROM folder WHERE owner = $owner AND name = $name AND id != $record;
LET $written = IF array::len($taken) = 0 { UPDATE folder SET name = $name WHERE owner = $owner AND id = $record RETURN folderId } ELSE { [] };
COMMIT TRANSACTION;
RETURN $written;`;

const renameFolder = (
  db: Surreal,
  owner: OwnerId,
  id: FolderId,
  name: FolderName
) =>
  run(
    db,
    RENAME,
    { owner, record: toRecord(id), name },
    folderRepositoryError
  ).pipe(
    Effect.map((results) => {
      const written = results.at(-1);

      return Array.isArray(written) && written.length > 0;
    })
  );

const removeFolders = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<FolderId>
) =>
  ids.length === 0
    ? Effect.void
    : write(
        db,
        'BEGIN TRANSACTION; LET $owned = SELECT VALUE folderId FROM folder WHERE owner = $owner AND id IN $records; LET $feeds = SELECT VALUE feedId FROM feed WHERE owner = $owner AND folderId IN $owned; DELETE feed_item WHERE owner = $owner AND feedId IN $feeds; DELETE feed WHERE owner = $owner AND feedId IN $feeds; DELETE folder WHERE owner = $owner AND id IN $records; COMMIT TRANSACTION;',
        { owner, records: recordsOf('folder', ids) },
        folderRepositoryError
      );

export const makeFolderRepository = (db: Surreal, lock: Semaphore.Semaphore) =>
  FolderRepository.of({
    find: (owner, id) => findFolder(db, owner, id),
    list: (owner) => listFolders(db, owner),
    create: (owner, folders) =>
      createFolders(db, owner, folders).pipe(lock.withPermit),
    rename: (owner, id, name) =>
      renameFolder(db, owner, id, name).pipe(lock.withPermit),
    remove: (owner, ids) => removeFolders(db, owner, ids).pipe(lock.withPermit),
  });
