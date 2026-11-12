import {
  Folder,
  FolderId,
  type FolderName,
  type FolderPatch,
  FolderRepository,
  type OwnerId,
} from '@reader/business';
import { Effect, Option, Schema, type Semaphore } from 'effect';
import { RecordId, type Surreal } from 'surrealdb';
import {
  type Bindings,
  createdIds,
  decodeReturned,
  folderRepositoryError,
  readRows,
  recordsOf,
  run,
  write,
} from './reader-store-sql';

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
) => {
  const rows = folders.filter((folder) => folder.ownerId === owner);

  if (rows.length === 0) {
    return Effect.succeed([] as ReadonlyArray<FolderId>);
  }

  const bindings: Bindings = { owner };
  rows.forEach((folder, index) => {
    bindings[`d${index}`] = encodeFolder(folder);
  });
  const statements = rows
    .map((_, index) => insertStatement(`$d${index}`, index))
    .join(' ');

  return run(
    db,
    `BEGIN TRANSACTION; LET $created = []; ${statements} COMMIT TRANSACTION; RETURN $created;`,
    bindings,
    folderRepositoryError
  ).pipe(Effect.map((results) => createdIds(rows, results)));
};

const existingIds = (
  db: Surreal,
  owner: OwnerId,
  records: ReadonlyArray<RecordId>
) =>
  run(
    db,
    'SELECT VALUE folderId FROM folder WHERE owner = $owner AND id IN $records;',
    { owner, records },
    folderRepositoryError
  ).pipe(
    Effect.flatMap((results) =>
      decodeReturned(results, Schema.Array(FolderId), folderRepositoryError)
    )
  );

const renameStatement = (row: string, index: number) => `
LET $t${index} = SELECT VALUE id FROM folder WHERE owner = $owner AND name = $name AND id != ${row};
LET $e${index} = SELECT VALUE folderId FROM folder WHERE owner = $owner AND id = ${row};
LET $u${index} = IF array::len($t${index}) = 0 { $e${index} } ELSE { [] };
LET $w${index} = IF array::len($u${index}) > 0 { UPDATE ${row} SET name = $name WHERE owner = $owner } ELSE { [] };
LET $written = array::concat($written, $u${index});`;

const renameFolders = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<FolderId>,
  name: FolderName
) => {
  const bindings: Bindings = { owner, name };
  ids.forEach((id, index) => {
    bindings[`r${index}`] = toRecord(id);
  });
  const statements = ids
    .map((_, index) => renameStatement(`$r${index}`, index))
    .join(' ');

  return run(
    db,
    `BEGIN TRANSACTION; LET $written = []; ${statements} COMMIT TRANSACTION; RETURN $written;`,
    bindings,
    folderRepositoryError
  ).pipe(
    Effect.flatMap((results) =>
      decodeReturned(results, Schema.Array(FolderId), folderRepositoryError)
    )
  );
};

const updateFolders = (
  db: Surreal,
  owner: OwnerId,
  ids: ReadonlyArray<FolderId>,
  patch: FolderPatch
) => {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    return Effect.succeed([] as ReadonlyArray<FolderId>);
  }

  const records = recordsOf('folder', unique);

  return patch.name === undefined
    ? existingIds(db, owner, records)
    : renameFolders(db, owner, unique, patch.name);
};

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
    update: (owner, ids, patch) =>
      updateFolders(db, owner, ids, patch).pipe(lock.withPermit),
    remove: (owner, ids) => removeFolders(db, owner, ids).pipe(lock.withPermit),
  });
