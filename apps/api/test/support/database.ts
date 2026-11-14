import { randomUUID } from 'node:crypto';
import { surrealAdapter } from '@surrealdb/better-auth';
import { Effect } from 'effect';
import type { Surreal } from 'surrealdb';
import { createSurreal } from '../../src/db';
import { readerStoreSchema } from '../../src/store/schema';

export const TEST_ORIGIN = 'http://localhost:3000';

const TEST_SECRET = 'route-test-secret-at-least-32-characters';

export const authOptions = (db: Surreal) => ({
  baseURL: TEST_ORIGIN,
  secret: TEST_SECRET,
  emailAndPassword: { enabled: true, autoSignIn: false },
  database: surrealAdapter({ db }),
});

export const openDatabase = Effect.acquireRelease(
  Effect.promise(async () => {
    const db = await createSurreal({
      endpoint: 'mem://',
      namespace: `route-library-${randomUUID()}`,
      database: 'test',
    });
    const options = authOptions(db);
    const schema = await options.database(options).createSchema?.(options);

    if (schema?.code) {
      await db.query(schema.code);
    }

    await db.query(readerStoreSchema);

    return db;
  }),
  (db) => Effect.promise(() => db.close())
);
