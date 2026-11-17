import { DatabaseSync } from 'node:sqlite';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { Layer, Redacted } from 'effect';
import { Auth, authOptions } from '../../../src/server/auth';
import { ServerConfig } from '../../../src/server/config';

/** The origin every test request and Better Auth use. */
export const TEST_ORIGIN = 'http://localhost:3000';

/** The configuration a test server runs with; no file is ever opened. */
export const testServerConfig = ServerConfig.of({
  port: 0,
  dataDir: '.test-data',
  secret: Redacted.make('test-secret-not-used-outside-tests'),
  authBaseUrl: new URL(TEST_ORIGIN),
});

export const TestConfigLive = Layer.succeed(ServerConfig, testServerConfig);

export type MemoryAuth = {
  readonly auth: ReturnType<typeof betterAuth>;
  readonly layer: Layer.Layer<Auth>;
};

/**
 * Better Auth over an in-memory database with its own migrations applied
 * (reader-engineering: Testing): a test never runs `db:migrate`. The
 * migrations and the instance share one `DatabaseSync`, which is what makes
 * `:memory:` usable.
 */
export const makeMemoryAuth = async (): Promise<MemoryAuth> => {
  const database = new DatabaseSync(':memory:');
  const options: BetterAuthOptions = authOptions({
    database,
    secret: testServerConfig.secret,
    authBaseUrl: testServerConfig.authBaseUrl,
  });

  await (await getMigrations(options)).runMigrations();

  const auth = betterAuth(options);

  return { auth, layer: Layer.succeed(Auth, auth) };
};
