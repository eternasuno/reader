import { DuplicateLink } from '@reader/api';
import { Effect, Exit, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AtomRegistry } from 'effect/reactivity';
import { describe, expect, it } from 'vitest';
import {
  type LinkCommand,
  LinksClientLive,
  makeReadingAtoms,
} from '../../src/lib/links';

type ReadingAtoms = ReturnType<typeof makeReadingAtoms>;

const makeTest = (options: { readonly markStatus?: number } = {}) => {
  const calls: string[] = [];
  const requests: {
    method: string;
    path: string;
    body: unknown;
  }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    expect(init?.credentials).toBe('include');
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    requests.push({
      method,
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (method === 'GET') {
      calls.push(
        `list:${url.searchParams.get('read')}:${url.searchParams.get('offset')}`
      );

      return Response.json({ items: [], hasMore: false });
    }
    if (method === 'PATCH' && options.markStatus !== undefined) {
      return Response.json(
        { error: '链接不存在' },
        { status: options.markStatus }
      );
    }

    return method === 'POST'
      ? Response.json(new DuplicateLink({ error: '已存在' }), { status: 409 })
      : Response.json({ ok: true });
  };
  const layer = LinksClientLive.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );
  const registry = AtomRegistry.make();
  const atoms = makeReadingAtoms(layer);
  registry.mount(atoms.page);

  return { registry, atoms, calls, requests };
};

const loadPage = (registry: AtomRegistry.AtomRegistry, atoms: ReadingAtoms) =>
  Effect.runPromise(
    AtomRegistry.getResult(registry, atoms.page, { suspendOnWaiting: true })
  );

const runCommand = (
  registry: AtomRegistry.AtomRegistry,
  atoms: ReadingAtoms,
  input: LinkCommand
) => {
  registry.set(atoms.command, input);

  return Effect.runPromiseExit(
    AtomRegistry.getResult(registry, atoms.command, { suspendOnWaiting: true })
  );
};

describe('reading-list queries', () => {
  it('loads typed queries and steps back when a mutation empties a later page', async () => {
    const { registry, atoms, calls } = makeTest();
    try {
      registry.set(atoms.query, { read: true, page: 2 });
      await loadPage(registry, atoms);
      await runCommand(registry, atoms, {
        _tag: 'Delete',
        key: 'a'.repeat(64),
      });
      expect(calls).toContain('list:true:60');
      expect(registry.get(atoms.query)).toEqual({ read: true, page: 1 });
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list marks', () => {
  it('marks without refetching the current page', async () => {
    const { registry, atoms, calls, requests } = makeTest();
    const key = 'a'.repeat(64);
    try {
      await loadPage(registry, atoms);
      const exit = await runCommand(registry, atoms, {
        _tag: 'Mark',
        key,
        read: true,
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(calls).toEqual(['list:false:0']);
      expect(registry.get(atoms.query)).toEqual({ read: false, page: 0 });
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/api/links',
        body: { key, read: true },
      });
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list mark failures', () => {
  it('keeps mark failures out of list state without refetching', async () => {
    const { registry, atoms, calls } = makeTest({ markStatus: 404 });
    try {
      await loadPage(registry, atoms);
      const exit = await runCommand(registry, atoms, {
        _tag: 'Mark',
        key: 'a'.repeat(64),
        read: true,
      });
      expect(Exit.isFailure(exit)).toBe(true);
      expect(registry.get(atoms.command)._tag).toBe('Failure');
      expect(calls).toEqual(['list:false:0']);
      expect(registry.get(atoms.query)).toEqual({ read: false, page: 0 });
    } finally {
      registry.dispose();
    }
  });
});

describe('reading-list failures', () => {
  it('keeps typed API failures and isolates registries between accounts', async () => {
    const first = makeTest();
    const second = makeTest();
    try {
      first.registry.set(first.atoms.query, { read: true, page: 3 });
      first.registry.set(first.atoms.command, {
        _tag: 'Add',
        url: 'https://example.com/',
      });
      const exit = await Effect.runPromiseExit(
        AtomRegistry.getResult(first.registry, first.atoms.command, {
          suspendOnWaiting: true,
        })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(first.registry.get(first.atoms.command)._tag).toBe('Failure');
      expect(first.registry.get(first.atoms.query)).toEqual({
        read: true,
        page: 3,
      });
      expect(second.registry.get(second.atoms.query)).toEqual({
        read: false,
        page: 0,
      });
    } finally {
      first.registry.dispose();
      second.registry.dispose();
    }
  });
});
