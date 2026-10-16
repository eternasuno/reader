import { expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { AuthLive } from '../../src/infrastructure/auth';
import { DatabaseLive } from '../../src/infrastructure/db';
import { Session, sessionMiddleware } from '../../src/middleware/session';

const baseUrl = 'http://localhost:5173';

const TestConfigLive = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    SURREAL: {
      ENDPOINT: 'mem://',
      NAMESPACE: 'session-test',
      DATABASE: 'configured',
    },
    BETTER_AUTH: {
      URL: baseUrl,
      SECRET: 'api-test-secret-at-least-32-characters',
    },
  })
);

const AuthTestLive = AuthLive.pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(TestConfigLive)
);

const ProtectedRouteLive = HttpRouter.add(
  'GET',
  '/protected',
  Effect.flatMap(Session, (user) => HttpServerResponse.json(user))
).pipe(Layer.provide(sessionMiddleware.layer), Layer.provide(AuthTestLive));

it.effect('rejects requests without a session', () =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(ProtectedRouteLive, { disableLogger: true })
    ),
    ({ handler }) =>
      Effect.gen(function* () {
        const request = new Request(`${baseUrl}/protected`);
        const response = yield* Effect.tryPromise(() => handler(request));
        const body = yield* Effect.tryPromise(() => response.json());

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: 'Unauthorized' });
      }),
    ({ dispose }) => Effect.promise(dispose)
  )
);
