import { Config, Context, Effect, Layer, type Redacted } from 'effect';

const DEFAULT_PORT = 3001;
const DEFAULT_DATA_DIR = '.data';
const DEFAULT_AUTH_URL = 'http://localhost:3000';

/**
 * The server's configuration, read once from the environment
 * (reader-engineering deployment.md): the HTTP port, the directory holding
 * `reader.db` and `auth.db`, Better Auth's signing secret and its canonical
 * public origin. The secret is `Redacted`, so it never reaches a log.
 */
export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    readonly port: number;
    readonly dataDir: string;
    readonly secret: Redacted.Redacted;
    readonly authBaseUrl: URL;
  }
>()('ServerConfig') {}

/** Reads `API_PORT`, `DATA_DIR`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. */
export const ServerConfigLive = Layer.effect(
  ServerConfig,
  Effect.gen(function* () {
    const port = yield* Config.Port('API_PORT').pipe(
      Config.withDefault(DEFAULT_PORT)
    );
    const dataDir = yield* Config.String('DATA_DIR').pipe(
      Config.withDefault(DEFAULT_DATA_DIR)
    );
    const secret = yield* Config.Redacted('BETTER_AUTH_SECRET');
    const authBaseUrl = yield* Config.URL('BETTER_AUTH_URL').pipe(
      Config.withDefault(new URL(DEFAULT_AUTH_URL))
    );

    return ServerConfig.of({ port, dataDir, secret, authBaseUrl });
  })
);
