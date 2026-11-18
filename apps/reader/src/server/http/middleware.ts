import { OwnerId } from '@reader/business';
import { Data, Effect, Layer, Schema, type Types } from 'effect';
import {
  Cookies,
  Headers,
  HttpEffect,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import { HttpApiError } from 'effect/http-api';
import {
  Authentication,
  AuthUnavailable,
  OriginCheck,
  Session,
} from '../../contract';
import { Auth } from '../auth';
import { ServerConfig } from '../config';

/**
 * Better Auth's session check failed; it is mapped to the contract's 500
 * `AuthUnavailable` so the HTTP API answers `{ "_tag": "AuthUnavailable" }`.
 */
class AuthCheckFailed extends Data.TaggedError('AuthCheckFailed')<{
  readonly cause: unknown;
}> {}

const ownerIdOf = Schema.decodeUnknownSync(OwnerId);

/**
 * Identity from the session cookie only (CM-OWN-1, AC-SESSION-2). Without a
 * session the answer is the empty-body 401; when the check itself fails it is
 * the 500 `AuthUnavailable` (reader-spec: API conventions). The headers Better
 * Auth returns are attached through a pre-response handler, so a renewed or
 * cleared session cookie reaches the browser on error responses too
 * (AC-SESSION-7).
 */
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const auth = yield* Auth;

    return (
      httpEffect: Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        Types.unhandled,
        Session
      >
    ) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* Effect.tryPromise({
          try: () =>
            auth.api.getSession({
              headers: new globalThis.Headers(request.headers),
              returnHeaders: true,
            }),
          catch: (cause) => new AuthCheckFailed({ cause }),
        }).pipe(
          Effect.tapError((failure) =>
            Effect.logWarning('Authentication unavailable', failure.cause)
          ),
          Effect.mapError(() => new AuthUnavailable())
        );

        const returned = new globalThis.Headers(session.headers);
        const cookies = Cookies.fromSetCookie(returned.getSetCookie());
        returned.delete('set-cookie');
        const headers = Headers.fromInput(returned.entries());

        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(
            HttpServerResponse.mergeCookies(
              HttpServerResponse.setHeaders(response, headers),
              cookies
            )
          )
        );

        if (session.response === null) {
          return yield* new HttpApiError.Unauthorized({});
        }

        return yield* Effect.provideService(httpEffect, Session, {
          ownerId: ownerIdOf(session.response.user.id),
        });
      });
  })
);

/**
 * A state-changing request whose `Origin` differs from the origin of
 * `BETTER_AUTH_URL` answers the empty-body 403; a request without `Origin`
 * passes (reader-spec: API conventions). Reads do not carry this middleware.
 */
export const OriginCheckLive = Layer.effect(
  OriginCheck,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const allowedOrigin = config.authBaseUrl.origin;

    return (
      httpEffect: Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        Types.unhandled,
        never
      >
    ) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { origin } = request.headers;

        if (origin !== undefined && origin !== allowedOrigin) {
          return yield* new HttpApiError.Forbidden({});
        }

        return yield* httpEffect;
      });
  })
);
