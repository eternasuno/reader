import { Context, Effect } from 'effect';
import {
  Cookies,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import { Auth, AuthUnavailable } from '../infrastructure/auth';

export class Session extends Context.Service<
  Session,
  { id: string; name: string; email: string }
>()('Session') {}

export const sessionMiddleware = HttpRouter.middleware<{
  provides: Session;
}>()(
  Effect.gen(function* () {
    const auth = yield* Auth;

    return (handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request);
        const session = yield* Effect.tryPromise({
          try: () =>
            auth.api.getSession({
              headers: webRequest.headers,
              returnHeaders: true,
            }),
          catch: (cause) => new AuthUnavailable({ cause }),
        });
        const response = session.response
          ? yield* Effect.provideService(handler, Session, {
              id: session.response.user.id,
              name: session.response.user.name,
              email: session.response.user.email,
            })
          : yield* HttpServerResponse.json(
              { error: 'Unauthorized' },
              { status: 401 }
            );
        const headers = new Headers(session.headers);
        const cookies = Cookies.fromSetCookie(headers.getSetCookie());
        headers.delete('set-cookie');

        return response.pipe(
          HttpServerResponse.setHeaders(headers),
          HttpServerResponse.mergeCookies(cookies)
        );
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning('Authentication unavailable', error)
        ),
        Effect.catchTag('AuthUnavailable', () =>
          HttpServerResponse.json(
            { error: 'Authentication unavailable' },
            { status: 500 }
          )
        )
      );
  })
);
