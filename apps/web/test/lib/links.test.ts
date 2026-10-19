import { DuplicateLink } from '@reader/api';
import { Effect, Exit, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AtomRegistry } from 'effect/reactivity';
import { describe, expect, it } from 'vitest';
import { LinksClientLive, makeReadingAtoms } from '../../src/lib/links';

const makeTest = () => {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    expect(init?.credentials).toBe('include');
    const url = new URL(String(input), 'http://localhost');
    if (init?.method === 'GET') {
      calls.push(
        `list:${url.searchParams.get('read')}:${url.searchParams.get('offset')}`
      );

      return Response.json({ items: [], hasMore: false });
    }

    return init?.method === 'POST'
      ? Response.json(new DuplicateLink({ error: '已存在' }), { status: 409 })
      : Response.json({ ok: true });
  };
  const layer = LinksClientLive.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );
  const registry = AtomRegistry.make();
  const atoms = makeReadingAtoms(layer);
  registry.mount(atoms.page);

  return { registry, atoms, calls };
};

describe('reading-list atoms', () => {
  it('loads typed queries and steps back when a mutation empties a later page', async () => {
    const { registry, atoms, calls } = makeTest();
    try {
      registry.set(atoms.query, { read: true, page: 2 });
      await Effect.runPromise(
        AtomRegistry.getResult(registry, atoms.page, { suspendOnWaiting: true })
      );
      registry.set(atoms.command, { _tag: 'Delete', key: 'a'.repeat(64) });
      await Effect.runPromise(
        AtomRegistry.getResult(registry, atoms.command, {
          suspendOnWaiting: true,
        })
      );
      expect(calls).toContain('list:true:60');
      expect(registry.get(atoms.query)).toEqual({ read: true, page: 1 });
    } finally {
      registry.dispose();
    }
  });

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
