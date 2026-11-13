import { ApiError, Authentication, Session } from '@reader/api';
import { Effect, Layer } from 'effect';
import {
  Cookies,
  HttpEffect,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import { HttpApiError } from 'effect/http-api';
import { Auth, AuthUnavailable } from '../../auth';

export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* Effect.tryPromise({
          try: () =>
            auth.api.getSession({
              headers: new Headers(request.headers),
              returnHeaders: true,
            }),
          catch: (cause) => new AuthUnavailable({ cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logWarning('Authentication unavailable', error)
          ),
          Effect.mapError(() => new ApiError.AuthUnavailable())
        );

        const headers = new Headers(session.headers);
        const cookies = Cookies.fromSetCookie(headers.getSetCookie());
        headers.delete('set-cookie');

        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(
            response.pipe(
              HttpServerResponse.setHeaders(headers),
              HttpServerResponse.mergeCookies(cookies)
            )
          )
        );

        if (!session.response) {
          return yield* new HttpApiError.Unauthorized({});
        }

        return yield* Effect.provideService(httpEffect, Session, {
          id: session.response.user.id,
          name: session.response.user.name,
          email: session.response.user.email,
        });
      });
  })
);
