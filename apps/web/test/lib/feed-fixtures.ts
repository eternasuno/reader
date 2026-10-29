import type { Feed, FeedArticle } from '@reader/api';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AtomRegistry } from 'effect/reactivity';
import { expect } from 'vitest';
import type { FeedCommand } from '../../src/lib/feeds';
import { makeFeedAtoms } from '../../src/lib/feeds';
import { LinksClientLive } from '../../src/lib/links';

export type FeedAtoms = ReturnType<typeof makeFeedAtoms>;

export type FeedPage = {
  readonly items: readonly FeedArticle[];
  readonly hasMore: boolean;
};

export type Request = {
  readonly method: string;
  readonly path: string;
  readonly params: URLSearchParams;
  readonly body: unknown;
};

export type TestOptions = {
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

export const article = (
  index: number,
  feedKey = 'feed',
  read = false
): FeedArticle => ({
  key: index.toString(16).padStart(64, '0'),
  feedKey,
  url: `https://example.com/article/${index}`,
  title: `Article ${index}`,
  publishedAt: new Date(Date.UTC(2026, 0, index)).toISOString(),
  read,
});

export const page = (
  items: readonly FeedArticle[],
  hasMore: boolean
): FeedPage => ({ items, hasMore });

export const feed = (key: string): Feed => ({
  key,
  url: `https://example.com/${key}.xml`,
  title: `Feed ${key}`,
  updatedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  error: '',
  unreadCount: 0,
});

const requestBody = (init: RequestInit | undefined): unknown =>
  init?.body ? JSON.parse(String(init.body)) : undefined;

const markLoadedKeys = (init: RequestInit | undefined): readonly string[] => {
  const body = requestBody(init);
  const keys =
    typeof body === 'object' && body !== null && 'keys' in body
      ? body.keys
      : undefined;

  return Array.isArray(keys)
    ? keys.filter((key: unknown): key is string => typeof key === 'string')
    : [];
};

const markLoadedResponse = (
  init: RequestInit | undefined,
  options: TestOptions
) => options.markLoaded?.(markLoadedKeys(init)) ?? Response.json({ ok: true });

const getResponse = (
  path: string,
  feeds: readonly Feed[],
  nextPage: () => FeedPage
) => {
  if (path === '/api/feeds') return Response.json({ items: feeds });
  if (path === '/api/feeds/articles') return Response.json(nextPage());

  return undefined;
};

const createFetch = (
  pages: readonly FeedPage[],
  feeds: readonly Feed[],
  options: TestOptions,
  requests: Request[]
): typeof globalThis.fetch => {
  let articleCalls = 0;
  const nextPage = () => {
    const current =
      pages[Math.min(articleCalls, pages.length - 1)] ?? page([], false);
    articleCalls += 1;

    return current;
  };

  return async (input, init) => {
    expect(init?.credentials).toBe('include');
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    requests.push({
      method,
      path: url.pathname,
      params: url.searchParams,
      body: requestBody(init),
    });
    if (method === 'GET') {
      const response = getResponse(url.pathname, feeds, nextPage);
      if (response) return response;
    }
    if (method === 'POST' && url.pathname === '/api/feeds/articles/mark-loaded')
      return markLoadedResponse(init, options);

    return Response.json({ ok: true });
  };
};

export const makeTest = (
  pages: readonly FeedPage[],
  feeds: readonly Feed[] = [],
  options: TestOptions = {}
) => {
  const requests: Request[] = [];
  const layer = LinksClientLive.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        createFetch(pages, feeds, options, requests)
      )
    )
  );
  const registry = AtomRegistry.make();
  const atoms = makeFeedAtoms(layer);
  registry.mount(atoms.articles);
  registry.mount(atoms.feeds);

  return { registry, atoms, requests };
};

export const articleRequests = (requests: readonly Request[]) =>
  requests.filter(
    (request) =>
      request.method === 'GET' && request.path === '/api/feeds/articles'
  );

export const runLoad = (
  registry: AtomRegistry.AtomRegistry,
  atoms: FeedAtoms,
  reset: boolean
) => {
  registry.set(atoms.load, { reset });

  return Effect.runPromiseExit(
    AtomRegistry.getResult(registry, atoms.load, { suspendOnWaiting: true })
  );
};

export const startCommand = (
  registry: AtomRegistry.AtomRegistry,
  atoms: FeedAtoms,
  input: FeedCommand
) => {
  registry.set(atoms.command, input);

  return Effect.runPromiseExit(
    AtomRegistry.getResult(registry, atoms.command, {
      suspendOnWaiting: true,
    })
  );
};

export const runCommand = (
  registry: AtomRegistry.AtomRegistry,
  atoms: FeedAtoms,
  input: FeedCommand
) => startCommand(registry, atoms, input);

export const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
