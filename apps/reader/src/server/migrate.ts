import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NodeRuntime } from '@effect/platform-node';
import { migrateReader, readerClientLayer } from '@reader/sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { Effect, Runtime } from 'effect';
import { authOptions } from './auth';
import { ServerConfig, ServerConfigLive } from './config';

/**
 * `pnpm db:migrate` (reader-engineering database.md): Better Auth's migrations
 * against `auth.db` and the reader migration against `reader.db`. The server
 * applies no schema at startup, so this runs once per deployment, with the
 * service stopped.
 */
export const migrate = Effect.gen(function* () {
  const config = yield* ServerConfig;
  yield* Effect.promise(() => mkdir(config.dataDir, { recursive: true }));

  const database = new DatabaseSync(join(config.dataDir, 'auth.db'));

  try {
    const plan = yield* Effect.tryPromise(() =>
      getMigrations(
        authOptions({
          database,
          secret: config.secret,
          authBaseUrl: config.authBaseUrl,
        })
      )
    );

    yield* Effect.tryPromise(() => plan.runMigrations());
    yield* Effect.logInfo(
      `auth schema: ${plan.toBeCreated.length} tables created, ${plan.toBeAdded.length} tables altered, ${plan.toBeAddedIndexes.length} indexes added`
    );
  } finally {
    database.close();
  }

  const applied = yield* migrateReader.pipe(
    Effect.provide(readerClientLayer(join(config.dataDir, 'reader.db')))
  );

  yield* Effect.logInfo(
    applied.length > 0
      ? `reader schema: ${applied.map(([id, name]) => `${id}_${name}`).join(', ')}`
      : 'reader schema up to date'
  );
});

if (import.meta.main) {
  NodeRuntime.runMain(migrate.pipe(Effect.provide(ServerConfigLive)), {
    teardown: (exit) => {
      Runtime.defaultTeardown(exit, (code) => process.exit(code));
    },
  });
}
