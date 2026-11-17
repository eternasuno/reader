import { SqliteClient } from '@effect/sql-sqlite-node';
import { Effect, Layer } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';

/**
 * SQLite defaults `foreign_keys` off on every connection, so it is set where
 * the connection is made (database.md).
 */
const enableForeignKeys = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`PRAGMA foreign_keys = ON`;
  })
);

/**
 * The reader connection (`<DATA_DIR>/reader.db`). The app resolves `DATA_DIR`
 * and passes the file name; the connection keeps WAL and the busy timeout the
 * library sets by default.
 */
export const readerClientLayer = (
  filename: string
): Layer.Layer<SqlClient.SqlClient, SqlError.SqlError> =>
  enableForeignKeys.pipe(Layer.provideMerge(SqliteClient.layer({ filename })));
