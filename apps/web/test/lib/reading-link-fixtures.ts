import { DuplicateLink, type LinkPage, type ReadingLink } from '@reader/api';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AtomRegistry } from 'effect/reactivity';
import { expect } from 'vitest';
import {
  type LinkCommand,
  LinksClientLive,
  makeReadingAtoms,
} from '../../src/lib/links';

export type ReadingAtoms = ReturnType<typeof makeReadingAtoms>;

export type Request = {
  readonly method: string;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly body: unknown;
};

export const link = (index: number, read = false): ReadingLink => {
  const key = index.toString(16).padStart(64, '0');

  return {
    key,
    url: `https://example.com/${index}`,
    title: `Article ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
    read,
  };
};

export const page = (
  items: readonly ReadingLink[],
  hasMore: boolean
): LinkPage => ({ items, hasMore });

export type TestOptions = {
  readonly pages?: readonly LinkPage[];
  readonly failListOnce?: boolean;
  readonly markStatus?: number;
  readonly markLoaded?: (
    keys: readonly string[]
  ) => Response | Promise<Response>;
};

export type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

export const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

type ListHandlers = {
  readonly list: () => Response;
  readonly markAll: () => Response;
  readonly markLoaded: (
    keys: readonly string[]
  ) => Response | Promise<Response>;
  readonly unread: () => Response;
};

const responseFor = (
  method: string,
  path: string,
  options: TestOptions,
  handlers: ListHandlers
) => {
  if (method === 'GET' && path === '/api/links/unread-count') {
    return handlers.unread();
  }

  if (method === 'GET' && path === '/api/links') {
    return handlers.list();
  }

  if (path === '/api/links/mark-all') {
    return handlers.markAll();
  }

  if (method === 'PATCH' && options.markStatus !== undefined) {
    return Response.json(
      { error: '链接不存在' },
      { status: options.markStatus }
    );
  }

  if (method === 'POST') {
    return Response.json(new DuplicateLink({ error: '已存在' }), {
      status: 409,
    });
  }

  return Response.json({ ok: true });
};

const createHandlers = (options: TestOptions): ListHandlers => {
  let listCalls = 0;
  let unreadCount = 7;
  const list = () => {
    if (options.failListOnce && listCalls === 0) {
      listCalls += 1;

      return Response.json({ error: '暂时无法加载' }, { status: 500 });
    }

    const pages = options.pages ?? [];
    const current =
      pages[Math.min(listCalls, pages.length - 1)] ?? page([], false);
    listCalls += 1;

    return Response.json(current);
  };
  const unread = () => Response.json({ count: unreadCount });
  const markAll = () => {
    unreadCount = 0;

    return Response.json({ ok: true });
  };
  const markLoaded = (keys: readonly string[]) =>
    options.markLoaded?.(keys) ?? Response.json({ ok: true });

  return { list, markAll, markLoaded, unread };
};

const markLoadedKeys = (init: RequestInit | undefined): readonly string[] => {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const keys = Array.isArray(body.keys) ? body.keys : [];

  return keys.filter((key: unknown): key is string => typeof key === 'string');
};

const makeFetch =
  (
    options: TestOptions,
    handlers: ListHandlers,
    requests: Request[]
  ): typeof globalThis.fetch =>
  async (input, init) => {
    expect(init?.credentials).toBe('include');
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    requests.push({
      method,
      path: url.pathname,
      params: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.pathname === '/api/links/mark-loaded') {
      return handlers.markLoaded(markLoadedKeys(init));
    }

    return responseFor(method, url.pathname, options, handlers);
  };

export const makeTest = (options: TestOptions = {}) => {
  const requests: Request[] = [];
  const layer = LinksClientLive.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        makeFetch(options, createHandlers(options), requests)
      )
    )
  );
  const registry = AtomRegistry.make();
  const atoms = makeReadingAtoms(layer);
  registry.mount(atoms.state);

  return { registry, atoms, requests };
};

export const listRequests = (requests: readonly Request[]) =>
  requests.filter(
    (request) => request.method === 'GET' && request.path === '/api/links'
  );

export const runLoad = (
  registry: AtomRegistry.AtomRegistry,
  atoms: ReadingAtoms,
  reset: boolean
) => {
  registry.set(atoms.load, { reset });

  return Effect.runPromiseExit(
    AtomRegistry.getResult(registry, atoms.load, { suspendOnWaiting: true })
  );
};

export const startCommand = (
  registry: AtomRegistry.AtomRegistry,
  atoms: ReadingAtoms,
  input: LinkCommand
) => {
  registry.set(atoms.command, input);

  return Effect.runPromiseExit(
    AtomRegistry.getResult(registry, atoms.command, {
      suspendOnWaiting: true,
    })
  );
};
