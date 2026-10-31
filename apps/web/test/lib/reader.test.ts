import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AtomRegistry } from 'effect/reactivity';
import { describe, expect, it } from 'vitest';
import { LinksClientLive } from '../../src/lib/links';
import {
  makeSettingsAtoms,
  type ReaderProvider,
  type SettingsCommand,
  toReaderProvider,
} from '../../src/lib/reader';

type TestOptions = {
  readonly provider?: ReaderProvider;
  readonly jinaConfigured?: boolean;
  readonly providerStatus?: number;
};

type ReaderSettingsAtoms = ReturnType<typeof makeSettingsAtoms>;

type Request = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
};

const readProvider = (body: unknown): ReaderProvider | undefined => {
  if (!body || typeof body !== 'object' || !('provider' in body)) {
    return undefined;
  }

  const { provider } = body;

  return typeof provider === 'string' ? toReaderProvider(provider) : undefined;
};

const readEndpoint = (body: unknown): string => {
  if (body && typeof body === 'object' && 'endpoint' in body) {
    return String(body.endpoint);
  }

  throw new Error('Missing browser endpoint');
};

const makeTest = (options: TestOptions = {}) => {
  const requests: Request[] = [];
  let provider: ReaderProvider = options.provider ?? 'jina';
  let jinaConfigured = options.jinaConfigured ?? false;
  let browserEndpoint = 'http://127.0.0.1:9222';
  const saveProvider = (body: unknown): Response => {
    if (options.providerStatus !== undefined) {
      return Response.json(
        { error: '保存失败' },
        { status: options.providerStatus }
      );
    }

    provider = readProvider(body) ?? provider;

    return Response.json({ ok: true });
  };
  const respond = (method: string, path: string, body: unknown): Response => {
    if (path === '/api/reader/provider') {
      return saveProvider(body);
    }

    if (path === '/api/reader/browser') {
      browserEndpoint = readEndpoint(body);

      return Response.json({ ok: true });
    }

    if (method === 'PUT' || method === 'DELETE') {
      jinaConfigured = method === 'PUT';

      return Response.json({ ok: true });
    }

    return Response.json({
      configured:
        provider === 'browser' ? Boolean(browserEndpoint) : jinaConfigured,
      browserEndpoint,
      jinaConfigured,
      provider,
    });
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    expect(init?.credentials).toBe('include');
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname, body });

    return respond(method, url.pathname, body);
  };
  const layer = LinksClientLive.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );
  const registry = AtomRegistry.make();
  const atoms = makeSettingsAtoms(layer);
  registry.mount(atoms.status);

  return { registry, atoms, requests };
};

const readStatus = (
  registry: AtomRegistry.AtomRegistry,
  atoms: ReaderSettingsAtoms
) =>
  Effect.runPromise(
    AtomRegistry.getResult(registry, atoms.status, { suspendOnWaiting: true })
  );

const runUpdate = (
  registry: AtomRegistry.AtomRegistry,
  atoms: ReaderSettingsAtoms,
  command: SettingsCommand
) => {
  registry.set(atoms.update, command);

  return Effect.runPromiseExit(
    AtomRegistry.getResult(registry, atoms.update, { suspendOnWaiting: true })
  );
};

describe('reader settings status', () => {
  it('keeps the ready flag separate from the Jina key status', async () => {
    const { registry, atoms } = makeTest({
      provider: 'browser',
      jinaConfigured: false,
    });
    try {
      expect(await readStatus(registry, atoms)).toEqual({
        configured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
        jinaConfigured: false,
        provider: 'browser',
      });
    } finally {
      registry.dispose();
    }
  });
});

describe('reader provider selection', () => {
  it('saves the chosen provider and keeps the Jina key', async () => {
    const { registry, atoms, requests } = makeTest({
      provider: 'jina',
      jinaConfigured: true,
    });
    try {
      await readStatus(registry, atoms);
      const exit = await runUpdate(registry, atoms, {
        _tag: 'Provider',
        provider: 'browser',
      });
      expect(exit._tag).toBe('Success');
      expect(requests).toContainEqual({
        method: 'PUT',
        path: '/api/reader/provider',
        body: { provider: 'browser' },
      });
      expect(await readStatus(registry, atoms)).toEqual({
        configured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
        jinaConfigured: true,
        provider: 'browser',
      });
    } finally {
      registry.dispose();
    }
  });

  it('reports a failed provider change without changing the server status', async () => {
    const { registry, atoms } = makeTest({
      provider: 'jina',
      providerStatus: 500,
    });
    try {
      await readStatus(registry, atoms);
      const exit = await runUpdate(registry, atoms, {
        _tag: 'Provider',
        provider: 'browser',
      });
      expect(exit._tag).toBe('Failure');
      expect((await readStatus(registry, atoms)).provider).toBe('jina');
    } finally {
      registry.dispose();
    }
  });
});

describe('reader key commands', () => {
  it('saves a new Jina key without changing the selected provider', async () => {
    const { registry, atoms, requests } = makeTest({
      provider: 'browser',
      jinaConfigured: false,
    });
    try {
      await readStatus(registry, atoms);
      const exit = await runUpdate(registry, atoms, {
        _tag: 'Key',
        key: 'new-key',
      });
      expect(exit._tag).toBe('Success');
      expect(requests).toContainEqual({
        method: 'PUT',
        path: '/api/reader/settings',
        body: { key: 'new-key' },
      });
      expect(await readStatus(registry, atoms)).toEqual({
        configured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
        jinaConfigured: true,
        provider: 'browser',
      });
    } finally {
      registry.dispose();
    }
  });

  it('deletes the Jina key while the browser provider stays ready', async () => {
    const { registry, atoms, requests } = makeTest({
      provider: 'browser',
      jinaConfigured: true,
    });
    try {
      await readStatus(registry, atoms);
      const exit = await runUpdate(registry, atoms, { _tag: 'DeleteKey' });
      expect(exit._tag).toBe('Success');
      expect(requests).toContainEqual({
        method: 'DELETE',
        path: '/api/reader/settings',
        body: undefined,
      });
      expect(await readStatus(registry, atoms)).toEqual({
        configured: true,
        browserEndpoint: 'http://127.0.0.1:9222',
        jinaConfigured: false,
        provider: 'browser',
      });
    } finally {
      registry.dispose();
    }
  });
});

describe('reader browser endpoint commands', () => {
  it('saves and clears the endpoint and refreshes readiness', async () => {
    const { registry, atoms, requests } = makeTest({ provider: 'browser' });
    try {
      await readStatus(registry, atoms);
      const endpoint = 'ws://browser.local:9222/devtools/browser/session';
      expect(
        (
          await runUpdate(registry, atoms, {
            _tag: 'BrowserEndpoint',
            endpoint,
          })
        )._tag
      ).toBe('Success');
      expect(requests).toContainEqual({
        method: 'PUT',
        path: '/api/reader/browser',
        body: { endpoint },
      });
      expect((await readStatus(registry, atoms)).browserEndpoint).toBe(
        endpoint
      );
      expect(
        (
          await runUpdate(registry, atoms, {
            _tag: 'BrowserEndpoint',
            endpoint: '',
          })
        )._tag
      ).toBe('Success');
      expect(await readStatus(registry, atoms)).toMatchObject({
        browserEndpoint: '',
        configured: false,
        provider: 'browser',
      });
    } finally {
      registry.dispose();
    }
  });
});

describe('reader provider values', () => {
  it('narrows form values to known providers', () => {
    expect(toReaderProvider('jina')).toBe('jina');
    expect(toReaderProvider('browser')).toBe('browser');
    expect(toReaderProvider('')).toBeUndefined();
    expect(toReaderProvider('other')).toBeUndefined();
  });
});
