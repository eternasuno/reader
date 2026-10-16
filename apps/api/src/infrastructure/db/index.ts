import { createNodeEngines } from '@surrealdb/node';
import { Config, Context, Data, Effect, Layer } from 'effect';
import { Surreal } from 'surrealdb';
import { codecOptions } from './codec.ts';

export type DbConfig = {
  endpoint: string;
  namespace: string;
  database: string;
};

export class Database extends Context.Service<Database, Surreal>()(
  'Database'
) {}

export class DatabaseConnectError extends Data.TaggedError(
  'DatabaseConnectError'
)<{
  readonly endpoint: string;
  readonly cause: unknown;
}> {}

export const createSurreal = (config: DbConfig): Promise<Surreal> => {
  const db = new Surreal({ engines: { ...createNodeEngines() }, codecOptions });
  return db
    .connect(config.endpoint, {
      namespace: config.namespace,
      database: config.database,
    })
    .then(() => db);
};

export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* Config.all({
      endpoint: Config.String('ENDPOINT').pipe(Config.withDefault('mem://')),
      namespace: Config.String('NAMESPACE').pipe(Config.withDefault('app')),
      database: Config.String('DATABASE').pipe(Config.withDefault('app')),
    }).pipe(Config.nested('SURREAL'));
    return yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => createSurreal(config),
        catch: (cause) =>
          new DatabaseConnectError({ endpoint: config.endpoint, cause }),
      }),
      (db) => Effect.promise(() => db.close())
    );
  })
);
