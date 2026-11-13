import { OriginCheck } from '@reader/api';
import { Effect, Layer } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiError } from 'effect/http-api';
import { Auth } from '../../auth';

export const OriginCheckLive = Layer.effect(
  OriginCheck,
  Effect.gen(function* () {
    const auth = yield* Auth;
    const context = yield* Effect.promise(() => auth.$context);
    const allowedOrigin = new URL(context.baseURL).origin;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { origin } = request.headers;

        if (origin && origin !== allowedOrigin) {
          return yield* new HttpApiError.Forbidden({});
        }

        return yield* httpEffect;
      });
  })
);
