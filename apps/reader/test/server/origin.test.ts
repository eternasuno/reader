import { describe, expect, it } from '@effect/vitest';
import { testRequest } from './support/app';
import { TEST_ORIGIN } from './support/auth';
import { makeProbeApp } from './support/probe';

const FOREIGN_ORIGIN = 'https://evil.example';

describe('OriginCheck middleware: foreign origin', () => {
  it('SKILL.md API conventions answers 403 with an empty body for a foreign Origin', async () => {
    const app = await makeProbeApp();
    const { cookie } = await app.signIn();

    const response = await app.handler(
      testRequest({
        method: 'POST',
        path: '/api/probe',
        cookie,
        origin: FOREIGN_ORIGIN,
      })
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('');

    await app.dispose();
  });
});

describe('OriginCheck middleware: requests that pass', () => {
  it('SKILL.md API conventions passes a state-changing request without Origin', async () => {
    const app = await makeProbeApp();
    const { cookie, userId } = await app.signIn();

    const response = await app.handler(
      testRequest({ method: 'POST', path: '/api/probe', cookie, origin: null })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerId: userId });

    await app.dispose();
  });

  it('SKILL.md API conventions passes a state-changing request from the auth origin', async () => {
    const app = await makeProbeApp();
    const { cookie } = await app.signIn();

    const response = await app.handler(
      testRequest({
        method: 'POST',
        path: '/api/probe',
        cookie,
        origin: TEST_ORIGIN,
      })
    );

    expect(response.status).toBe(200);

    await app.dispose();
  });

  it('SKILL.md API conventions leaves a read alone whatever its Origin', async () => {
    const app = await makeProbeApp();
    const { cookie } = await app.signIn();

    const response = await app.handler(
      testRequest({
        path: '/api/probe',
        cookie,
        origin: FOREIGN_ORIGIN,
      })
    );

    expect(response.status).toBe(200);

    await app.dispose();
  });
});
