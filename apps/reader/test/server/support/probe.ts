import { Effect, Layer, Schema } from 'effect';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/http-api';
import { Authentication, OriginCheck, Session } from '../../../src/contract';
import { AuthRoutesLive } from '../../../src/server/auth';
import {
  AuthenticationLive,
  OriginCheckLive,
} from '../../../src/server/http/middleware';
import { makeTestServer, type TestApp } from './app';
import { type MemoryAuth, makeMemoryAuth } from './auth';

const ProbeResponse = Schema.Struct({ ownerId: Schema.String });

/**
 * A two-endpoint API that applies the real middleware to a trivial handler, so
 * the tests observe the session and the origin rule without depending on the
 * contract's handlers: a read and a state-changing write.
 */
const ProbeApi = HttpApi.make('probe')
  .add(
    HttpApiGroup.make('probe').add(
      HttpApiEndpoint.get('read', '/probe', { success: ProbeResponse }),
      HttpApiEndpoint.post('write', '/probe', {
        success: ProbeResponse,
      }).middleware(OriginCheck)
    )
  )
  .middleware(Authentication)
  .prefix('/api');

const probeHandlers = HttpApiBuilder.group(ProbeApi, 'probe', (handlers) =>
  handlers
    .handle('read', () => Effect.map(Session, (session) => ({ ...session })))
    .handle('write', () => Effect.map(Session, (session) => ({ ...session })))
);

/**
 * The probe app: the real Better Auth route and middleware over an in-memory
 * store. `auth` replaces Better Auth itself, for the cases a working instance
 * cannot produce (a throwing session check, a renewed cookie).
 */
export const makeProbeApp = async (
  options: { readonly auth?: MemoryAuth } = {}
): Promise<TestApp> => {
  const memory = options.auth ?? (await makeMemoryAuth());
  const routes = Layer.mergeAll(
    HttpApiBuilder.layer(ProbeApi).pipe(
      Layer.provide(probeHandlers),
      Layer.provide(Layer.mergeAll(AuthenticationLive, OriginCheckLive))
    ),
    AuthRoutesLive
  );

  return makeTestServer(routes, memory);
};
