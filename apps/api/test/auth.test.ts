import { expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';
import { authOptions } from '../src/auth';
import { AuthDatabase } from '../src/db';
import { openAuthDatabase } from './support/database';

const TestConfigLive = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    BETTER_AUTH: {
      URL: 'http://localhost:5173',
      SECRET: 'api-test-secret-at-least-32-characters',
    },
  })
);

it.effect('builds project authentication options', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const database = yield* openAuthDatabase;
      const options = yield* authOptions.pipe(
        Effect.provideService(AuthDatabase, database),
        Effect.provide(TestConfigLive)
      );

      expect(options.appName).toBe('Reader API');
      expect(options.baseURL).toBe('http://localhost:5173/');
      expect(options.emailAndPassword).toEqual({
        enabled: true,
        autoSignIn: false,
      });
      expect(options.telemetry).toEqual({ enabled: false });
    })
  )
);
