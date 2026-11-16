import { NodeRuntime } from '@effect/platform-node';
import { SqliteMigrator } from '@effect/sql-sqlite-node';
import { getMigrations } from 'better-auth/db/migration';
import { Effect, Layer, Runtime } from 'effect';
import { authOptions } from './auth.ts';
import { AuthDatabaseLive, ReaderDatabaseLive } from './db';
import { readerMigrations } from './store/schema';

export const migrate = Effect.gen(function* () {
  const options = yield* authOptions;
  const auth = yield* Effect.tryPromise(() => getMigrations(options));

  yield* Effect.tryPromise(() => auth.runMigrations());
  yield* Effect.logInfo(
    `auth schema: ${auth.toBeCreated.length} tables created, ${auth.toBeAdded.length} tables altered, ${auth.toBeAddedIndexes.length} indexes added`
  );

  const applied = yield* SqliteMigrator.run({ loader: readerMigrations });
  yield* Effect.logInfo(
    applied.length > 0
      ? `reader schema: ${applied.map(([id, name]) => `${id}_${name}`).join(', ')}`
      : 'reader schema up to date'
  );
});

if (import.meta.main) {
  NodeRuntime.runMain(
    migrate.pipe(
      Effect.provide(Layer.merge(ReaderDatabaseLive, AuthDatabaseLive))
    ),
    {
      teardown: (exit) => {
        Runtime.defaultTeardown(exit, (code) => process.exit(code));
      },
    }
  );
}
