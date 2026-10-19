import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { Auth } from '../infrastructure/auth';

export const checkOrigin = HttpRouter.middleware()(
  Effect.gen(function* () {
    const auth = yield* Auth;
    const context = yield* Effect.promise(() => auth.$context);
    const allowedOrigin = new URL(context.baseURL).origin;

    return (handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const origin = request.headers['origin'];

        if (request.method !== 'GET' && origin && origin !== allowedOrigin) {
          return yield* HttpServerResponse.json(
            { error: '不允许跨站修改' },
            { status: 403 }
          );
        }

        return yield* handler;
      });
  })
);
