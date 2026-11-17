import { AuthDatabase } from '@reader/sqlite';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { Config, Context, Data, Effect, Layer, Redacted } from 'effect';

export class Auth extends Context.Service<
  Auth,
  ReturnType<typeof betterAuth>
>()('Auth') {}

export class AuthUnavailable extends Data.TaggedError('AuthUnavailable')<{
  readonly cause: unknown;
}> {}

export const authOptions = Effect.gen(function* () {
  const database = yield* AuthDatabase;
  const authConfig = yield* Config.all({
    url: Config.URL('URL').pipe(
      Config.withDefault(new URL('http://localhost:3000'))
    ),
    secret: Config.Redacted('SECRET'),
  }).pipe(Config.nested('BETTER_AUTH'));

  return {
    appName: 'Reader API',
    emailAndPassword: { enabled: true, autoSignIn: false },
    telemetry: { enabled: false },
    baseURL: authConfig.url.toString(),
    secret: Redacted.value(authConfig.secret),
    database,
  } satisfies BetterAuthOptions;
});

export const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const options = yield* authOptions;

    return betterAuth<BetterAuthOptions>(options);
  })
);
