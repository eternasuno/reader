import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { Context, Data, Effect, Layer, Redacted } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { ServerConfig } from './config';

/**
 * Better Auth's instance: the only owner of accounts and sessions
 * (reader-spec account.md, AC-SESSION-1). Its `api` is what the
 * `Authentication` middleware reads a session with and its `handler` is what
 * the `/api/auth/*` route passes a Web request to.
 */
export class Auth extends Context.Service<
  Auth,
  ReturnType<typeof betterAuth>
>()('Auth') {}

/**
 * Better Auth's options. The database is its own file (`auth.db`), kept apart
 * from the reader data (database.md: Files and connections); the secret stays
 * `Redacted` until Better Auth needs the string.
 */
export const authOptions = (options: {
  readonly database: DatabaseSync;
  readonly secret: Redacted.Redacted;
  readonly authBaseUrl: URL;
}): BetterAuthOptions => ({
  appName: '留白',
  baseURL: options.authBaseUrl.toString(),
  secret: Redacted.value(options.secret),
  database: options.database,
  emailAndPassword: { enabled: true, autoSignIn: false },
  telemetry: { enabled: false },
});

/**
 * Better Auth over one database file, opened when the layer is built and
 * closed with its scope. The directory must exist; `main` and `migrate` create
 * it. Tests pass `:memory:`.
 */
export const authLive = (
  filename: string
): Layer.Layer<Auth, never, ServerConfig> =>
  Layer.effect(
    Auth,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const database = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(filename)),
        (db) => Effect.sync(() => db.close())
      );

      return betterAuth(
        authOptions({
          database,
          secret: config.secret,
          authBaseUrl: config.authBaseUrl,
        })
      );
    })
  );

/** Better Auth over `<DATA_DIR>/auth.db` (database.md). */
export const AuthLive = Layer.unwrap(
  Effect.map(ServerConfig, (config) =>
    authLive(join(config.dataDir, 'auth.db'))
  )
);

/** Better Auth's handler threw; the route answers 500 and logs the cause. */
class AuthHandlerFailed extends Data.TaggedError('AuthHandlerFailed')<{
  readonly cause: unknown;
}> {}

const unavailable = HttpServerResponse.jsonUnsafe(
  { error: 'Authentication unavailable' },
  { status: 500 }
);

/**
 * `/api/auth/*` belongs to Better Auth (reader-spec account.md, AC-SESSION-1):
 * one wildcard route converts the request into a Web `Request`, hands it to
 * Better Auth and returns its response unchanged, cookie headers included. A
 * handler that throws answers 500 `{ "error": "Authentication unavailable" }`.
 */
export const AuthRoutesLive = HttpRouter.add('*', '/api/auth/*', (request) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const webRequest = yield* HttpServerRequest.toWeb(request);
    const response = yield* Effect.tryPromise({
      try: () => auth.handler(webRequest),
      catch: (cause) => new AuthHandlerFailed({ cause }),
    });

    return HttpServerResponse.fromWeb(response);
  }).pipe(
    Effect.tapError((failure) =>
      Effect.logError('Authentication unavailable', failure.cause)
    ),
    Effect.catchTag('AuthHandlerFailed', () => Effect.succeed(unavailable))
  )
);
