import type { Mock } from 'vitest';
import { jsonResponse, makePage, noContentResponse } from './state-fixture';

/** Answers the non-write reads that mark-all tests need. */
export const answerLibraryRead = (url: string): Promise<Response> => {
  if (url.startsWith('/api/saved-pages?')) {
    return Promise.resolve(
      jsonResponse({
        items: [
          makePage({ id: 'p1', read: true }),
          makePage({ id: 'p2', read: true }),
        ],
        cursor: null,
        boundary: '019363b8-0000-7000-8000-000000000002',
      })
    );
  }
  if (url === '/api/saved-pages/unread-count')
    return Promise.resolve(
      jsonResponse({
        count: 0,
        boundary: '019363b8-0000-7000-8000-000000000002',
      })
    );
  if (url === '/api/feeds/unread-counts')
    return Promise.resolve(
      jsonResponse({
        items: [],
        boundary: '019363b8-0000-7000-8000-000000000002',
      })
    );
  return Promise.resolve(jsonResponse({ items: [] }));
};

export interface DeferredWrites {
  /** Non-GET requests in send order, as `METHOD url`. */
  order: Array<string>;
  resolveNext: (url: string) => void;
  rejectNext: (url: string) => void;
  count: (url: string) => number;
}

interface PendingWrite {
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Answers GETs immediately and holds `PATCH` and `read-all` writes until a test settles them. */
export const routeDeferredWrites = (fetchMock: Mock): DeferredWrites => {
  const order: Array<string> = [];
  const deferred = new Map<string, Array<PendingWrite>>();
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') order.push(`${method} ${url}`);
    if (method !== 'PATCH' && !url.endsWith('/read-all'))
      return answerLibraryRead(url);
    return new Promise<Response>((resolve, reject) => {
      const list = deferred.get(url) ?? [];
      list.push({ resolve: () => resolve(noContentResponse()), reject });
      deferred.set(url, list);
    });
  });
  return {
    order,
    resolveNext: (url) => deferred.get(url)?.shift()?.resolve(),
    rejectNext: (url) =>
      deferred.get(url)?.shift()?.reject(new TypeError('network down')),
    count: (url) => deferred.get(url)?.length ?? 0,
  };
};
