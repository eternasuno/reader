import {
  NodeFileSystem,
  NodeHttpPlatform,
  NodePath,
} from '@effect/platform-node';
import { Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { expect, it } from 'vitest';
import { staticRoutes } from '../../src/routes/static';

it('preserves explicit API routes when static routes are mounted', async () => {
  const routes = Layer.mergeAll(
    HttpRouter.add('GET', '/api/auth/test', HttpServerResponse.text('auth')),
    staticRoutes
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeFileSystem.layer,
        NodePath.layer,
        NodeHttpPlatform.layer
      )
    )
  );
  const { handler, dispose } = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
  });

  try {
    const response = await handler(
      new Request('http://localhost/api/auth/test', {
        headers: { accept: 'text/html' },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('auth');
  } finally {
    await dispose();
  }
});
