import { Context } from 'effect';
import { HttpApiError, HttpApiMiddleware } from 'effect/http-api';
import { AuthUnavailable } from './errors';

/** The Better Auth identity of the request that reached the handler. */
export class Session extends Context.Service<
  Session,
  { readonly id: string; readonly name: string; readonly email: string }
>()('Session') {}

/** Rejects a library request without a session and provides it with one. */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: Session }
>()('Authentication', {
  error: [HttpApiError.Unauthorized, AuthUnavailable],
}) {}

/** Rejects a cross-site request to an endpoint that changes state. */
export class OriginCheck extends HttpApiMiddleware.Service<OriginCheck>()(
  'OriginCheck',
  { error: HttpApiError.Forbidden }
) {}
