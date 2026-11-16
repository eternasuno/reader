import { DatabaseSync } from 'node:sqlite';
import type { BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { Effect } from 'effect';

export const TEST_ORIGIN = 'http://localhost:3000';

const TEST_SECRET = 'route-test-secret-at-least-32-characters';

export const authOptions = (database: DatabaseSync): BetterAuthOptions => ({
  baseURL: TEST_ORIGIN,
  secret: TEST_SECRET,
  emailAndPassword: { enabled: true, autoSignIn: false },
  database,
});

export const openAuthDatabase = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(':memory:')),
  (database) => Effect.sync(() => database.close())
);

export const migrateAuth = (options: BetterAuthOptions) =>
  Effect.promise(async () => {
    const migrations = await getMigrations(options);

    await migrations.runMigrations();
  });
