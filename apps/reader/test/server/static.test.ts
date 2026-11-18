import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import * as NodeHttpPlatform from '@effect/platform-node/NodeHttpPlatform';
import * as NodePath from '@effect/platform-node/NodePath';
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest';
import { Layer } from 'effect';
import { Etag, HttpRouter } from 'effect/http';
import { StaticRoutesLive } from '../../src/server/static';

const HTML = { accept: 'text/html,application/xhtml+xml' };

const platform = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeHttpPlatform.layer,
  Etag.layer
);

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(new URL(path, 'http://localhost:3000'), { headers });

const head = (path: string) =>
  new Request(new URL(path, 'http://localhost:3000'), {
    method: 'HEAD',
    headers: HTML,
  });

/**
 * The static layer serves the fixed root `public` from the working directory
 * (reader-engineering deployment.md), so the test runs in a directory that
 * holds one, and restores the working directory afterwards.
 */
const cwd = process.cwd();
let root: string;
let handler: (request: Request) => Promise<Response>;
let dispose: () => Promise<void>;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'reader-static-'));
  await mkdir(join(root, 'public'));
  await writeFile(join(root, 'public', 'index.html'), '<title>留白</title>');
  await writeFile(join(root, 'public', 'app.js'), 'export {};');
  process.chdir(root);

  const web = HttpRouter.toWebHandler(
    StaticRoutesLive.pipe(Layer.provide(platform)),
    { disableLogger: true }
  );
  handler = web.handler;
  dispose = web.dispose;
});

afterAll(async () => {
  await dispose();
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

describe('static files', () => {
  it('deployment.md serves a built asset with Cache-Control: no-cache', async () => {
    const response = await handler(request('/app.js'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('deployment.md answers 404 for a path with an extension', async () => {
    const response = await handler(request('/missing.js', HTML));

    expect(response.status).toBe(404);
  });

  it('deployment.md answers a request that does not accept HTML with 404', async () => {
    const response = await handler(request('/later'));

    expect(response.status).toBe(404);
  });
});

describe('the single-page fallback', () => {
  it('deployment.md answers an extensionless GET accepting HTML with index.html', async () => {
    const response = await handler(request('/later', HTML));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('留白');
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it('deployment.md falls back under /api and /assets too', async () => {
    const api = await handler(request('/api/unknown', HTML));
    const assets = await handler(request('/assets/entry', HTML));

    expect(api.status).toBe(200);
    expect(await api.text()).toContain('留白');
    expect(assets.status).toBe(200);
  });

  it('deployment.md falls back for HEAD as well', async () => {
    const response = await handler(head('/all'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });
});
