import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Config, Context, Data, Effect, Layer } from 'effect';
import { readerSqliteLayer } from '../store/client';

class DatabaseConnectError extends Data.TaggedError('DatabaseConnectError')<{
  readonly path: string;
  readonly cause: unknown;
}> {}

const dataDirectory = Config.String('DATA_DIR').pipe(
  Config.withDefault('.data')
);

const dataFileName = (file: string) =>
  Effect.gen(function* () {
    const directory = yield* dataDirectory;

    yield* Effect.try({
      try: () => mkdirSync(directory, { recursive: true }),
      catch: (cause) => new DatabaseConnectError({ path: directory, cause }),
    });

    return join(directory, file);
  });

export const ReaderDatabaseLive = Layer.unwrap(
  Effect.map(dataFileName('reader.db'), readerSqliteLayer)
);

export class AuthDatabase extends Context.Service<AuthDatabase, DatabaseSync>()(
  'AuthDatabase'
) {}

export const AuthDatabaseLive = Layer.effect(
  AuthDatabase,
  Effect.gen(function* () {
    const filename = yield* dataFileName('auth.db');

    return yield* Effect.acquireRelease(
      Effect.try({
        try: () => new DatabaseSync(filename),
        catch: (cause) => new DatabaseConnectError({ path: filename, cause }),
      }),
      (db) => Effect.sync(() => db.close())
    );
  })
);
