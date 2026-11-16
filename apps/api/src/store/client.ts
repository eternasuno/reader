import { SqliteClient } from '@effect/sql-sqlite-node';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';

const enableForeignKeys = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`PRAGMA foreign_keys = ON`;
  })
);

export const readerSqliteLayer = (filename: string) =>
  enableForeignKeys.pipe(Layer.provideMerge(SqliteClient.layer({ filename })));
