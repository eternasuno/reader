import { describe, expect, it } from '@effect/vitest';
import { Layer } from 'effect';
import { Auth } from '../../src/server/auth';
import { testRequest } from './support/app';
import { type MemoryAuth, makeMemoryAuth } from './support/auth';
import { makeProbeApp } from './support/probe';

/** A Better Auth whose session check throws, as an unreachable auth service would. */
const unreachableAuth = (getSession: () => Promise<unknown>) => {
  const auth = { api: { getSession } } as unknown as MemoryAuth['auth'];

  return { auth, layer: Layer.succeed(Auth, auth) };
};

describe('Authentication middleware: identity', () => {
  it('AC-SESSION-3 answers 401 with an empty body without a session cookie', async () => {
    const app = await makeProbeApp();

    const response = await app.handler(testRequest({ path: '/api/probe' }));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');

    await app.dispose();
  });

  it('SKILL.md API conventions answers 500 AuthUnavailable when the check fails', async () => {
    const app = await makeProbeApp({
      auth: unreachableAuth(() => Promise.reject(new Error('auth is down'))),
    });

    const response = await app.handler(testRequest({ path: '/api/probe' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ _tag: 'AuthUnavailable' });

    await app.dispose();
  });

  it('CM-OWN-1 provides the session owner to the handler', async () => {
    const app = await makeProbeApp();
    const { cookie, userId } = await app.signIn('owner@example.com');

    const response = await app.handler(
      testRequest({ path: '/api/probe', cookie })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerId: userId });

    await app.dispose();
  });
});

describe('Authentication middleware: the check itself fails', () => {
  it('AC-SESSION-7 forwards the cookies Better Auth returns on an error response', async () => {
    const app = await makeProbeApp({
      auth: unreachableAuth(() =>
        Promise.resolve({
          headers: new Headers({
            'set-cookie': 'reader.session=cleared; Path=/; Max-Age=0',
          }),
          response: null,
        } as unknown as Awaited<
          ReturnType<MemoryAuth['auth']['api']['getSession']>
        >)
      ),
    });

    const response = await app.handler(testRequest({ path: '/api/probe' }));

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().join(';')).toContain(
      'reader.session=cleared'
    );

    await app.dispose();
  });

  it('AC-ACCOUNT-4 accepts a session cookie the auth route issued', async () => {
    const memory = await makeMemoryAuth();
    const app = await makeProbeApp({ auth: memory });
    const { cookie } = await app.signIn('second@example.com');

    const session = await app.handler(
      testRequest({ path: '/api/auth/get-session', cookie })
    );

    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      user: { email: 'second@example.com' },
    });

    await app.dispose();
  });
});
