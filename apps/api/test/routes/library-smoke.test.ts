import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { call, sessionFor } from './library-fixtures';
import { makeHarness } from './library-support';

it.effect('rejects library requests without a session', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();

      const response = yield* call(harness, {
        path: '/api/library/saved-pages',
        query: { limit: 30 },
      });

      expect(response.status).toBe(401);
    })
  )
);

it.effect('rejects cross-site library modifications', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const session = yield* sessionFor(harness, 'alice@example.com');

      const response = yield* call(harness, {
        method: 'POST',
        path: '/api/library/saved-pages',
        cookie: session.cookie,
        origin: 'https://untrusted.example',
        body: { url: 'https://example.com/post' },
      });

      expect(response.status).toBe(403);
    })
  )
);
