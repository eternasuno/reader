import { expect, it } from '@effect/vitest';
import { KindleNotConfigured } from '@reader/business';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { ReaderApi } from '../../../src/contract';
import { KindleSendInProgress } from '../../../src/server/kindle/sender';
import { httpLayer } from './support';

const client = () => HttpApiTest.groups(ReaderApi, ['kindle']);

it.effect('POST /api/kindle/send KD-SEND-8 answers the count of the send', () =>
  Effect.gen(function* () {
    const api = yield* client();

    expect(yield* api.kindle.sendToKindle()).toEqual({ count: 2 });
  }).pipe(
    Effect.provide(httpLayer({ kindle: () => Effect.succeed({ count: 2 }) }))
  )
);

it.effect('POST /api/kindle/send KD-SEND-1 answers 422 with no delivery', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const response = yield* api.kindle.sendToKindle({
      responseMode: 'response-only',
    });

    expect(response.status).toBe(422);
    expect(yield* response.json).toEqual({ _tag: 'KindleNotConfigured' });
  }).pipe(
    Effect.provide(
      httpLayer({ kindle: () => Effect.fail(new KindleNotConfigured()) })
    )
  )
);

it.effect('POST /api/kindle/send KD-SEND-7 answers 409 while one runs', () =>
  Effect.gen(function* () {
    const api = yield* client();
    const response = yield* api.kindle.sendToKindle({
      responseMode: 'response-only',
    });

    expect(response.status).toBe(409);
    expect(yield* response.json).toEqual({ _tag: 'KindleSendInProgress' });
  }).pipe(
    Effect.provide(
      httpLayer({ kindle: () => Effect.fail(new KindleSendInProgress()) })
    )
  )
);
