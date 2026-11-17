import type { OwnerId } from '@reader/business';
import { Context } from 'effect';
import { HttpApiError, HttpApiMiddleware } from 'effect/http-api';
import { AuthUnavailable } from './errors';

/**
 * The identity of the request that reached a handler: the owner every use case
 * is scoped by (CM-OWN-1). It comes only from the session cookie, never from
 * client input, and handlers and middleware share this service.
 */
export class Session extends Context.Service<
  Session,
  { readonly ownerId: OwnerId }
>()('Session') {}

/**
 * Rejects a request without a session with the empty-body 401 `Unauthorized`
 * and provides `Session` with a request that has one. When Better Auth's
 * session check itself fails it answers 500 `{ "_tag": "AuthUnavailable" }`
 * (reader-spec: API conventions).
 */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: Session }
>()('Authentication', {
  error: [HttpApiError.UnauthorizedNoContent, AuthUnavailable],
}) {}

/**
 * Rejects a state-changing request whose `Origin` header differs from the
 * configured auth base URL with the empty-body 403 `Forbidden`; a request
 * without `Origin` passes (reader-spec: API conventions).
 */
export class OriginCheck extends HttpApiMiddleware.Service<OriginCheck>()(
  'OriginCheck',
  { error: HttpApiError.ForbiddenNoContent }
) {}
