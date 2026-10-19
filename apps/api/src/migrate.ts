import { NodeRuntime } from '@effect/platform-node';
import { Data, Effect, Runtime } from 'effect';
import { articlesSchema } from './infrastructure/articles';
import { authOptions } from './infrastructure/auth.ts';
import { Database, DatabaseLive } from './infrastructure/db';
import { feedsSchema } from './infrastructure/feeds';
import { linksSchema } from './infrastructure/links';

export class SchemaUnsupported extends Data.TaggedError('SchemaUnsupported')<{
  message: string;
}> {}

export const migrate = Effect.gen(function* () {
  const db = yield* Database;
  const options = yield* authOptions;
  const createSchema = options.database(options).createSchema;

  if (createSchema === undefined) {
    return yield* new SchemaUnsupported({
      message: 'The auth adapter does not support schema generation',
    });
  }

  return yield* Effect.tryPromise(async () => {
    const schema = await createSchema(options);
    await db.query(linksSchema + feedsSchema + articlesSchema);

    if (schema.code.length > 0) {
      await db.query(schema.code);

      return true;
    }

    return false;
  });
});

if (import.meta.main) {
  NodeRuntime.runMain(
    migrate.pipe(
      Effect.tap((result) =>
        Effect.logInfo(
          result ? 'auth schema migrated' : 'auth schema up to date'
        )
      ),
      Effect.provide(DatabaseLive)
    ),
    {
      teardown: (exit) => {
        Runtime.defaultTeardown(exit, (code) => process.exit(code));
      },
    }
  );
}
