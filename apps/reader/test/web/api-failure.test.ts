import { afterEach, describe, expect, it, vi } from 'vitest';
import { onUnauthorized } from '../../src/web/api/client';
import {
  addSavedPage,
  getSavedPageUnreadCount,
  removeSavedPage,
  saveFeedItem,
} from '../../src/web/api/saved-page';
import { getSetting } from '../../src/web/api/setting';

/**
 * The failure model of `api/` against a stub fetch: a declared error body keeps
 * its tag and detail, an empty 401/403 its middleware tag, and every other
 * answer becomes one of the transport tags (reader-spec API conventions).
 */

type Reply = {
  readonly status: number;
  readonly body?: unknown;
};

type FetchArgs = [RequestInfo | URL, RequestInit | undefined];

/** A lower-case UUIDv7, the only shape the contract's id schemas encode. */
const id = '0193c1f0-9f00-7a2b-8c1d-0123456789ab';

const bodyInit = (reply: Reply): BodyInit | null =>
  reply.body === undefined ? null : JSON.stringify(reply.body);

const headers = (reply: Reply): Record<string, string> =>
  reply.body === undefined ? {} : { 'content-type': 'application/json' };

const stubFetch = (reply: Reply) => {
  const fetchStub = vi.fn((...args: FetchArgs) => {
    void args;

    return Promise.resolve(
      new Response(bodyInit(reply), {
        status: reply.status,
        headers: headers(reply),
      })
    );
  });

  vi.stubGlobal('fetch', fetchStub);

  return fetchStub;
};

const failingFetch = () => {
  const fetchStub = vi.fn((...args: FetchArgs) => {
    void args;

    return Promise.reject(new TypeError('no network'));
  });

  vi.stubGlobal('fetch', fetchStub);

  return fetchStub;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a declared contract error', () => {
  it('keeps its tag and its url', async () => {
    stubFetch({
      status: 409,
      body: { _tag: 'SavedPageAlreadyExists', url: 'https://example.com/' },
    });

    await expect(addSavedPage('https://example.com')).rejects.toMatchObject({
      name: 'ApiFailure',
      tag: 'SavedPageAlreadyExists',
      url: 'https://example.com/',
    });
  });

  it('is decoded whatever its status', async () => {
    stubFetch({ status: 422, body: { _tag: 'ArticleExtractorError' } });

    await expect(addSavedPage('https://example.com')).rejects.toMatchObject({
      tag: 'ArticleExtractorError',
    });
  });

  it('keeps the id a missing row carries', async () => {
    stubFetch({
      status: 404,
      body: { _tag: 'FeedItemNotFound', id },
    });

    await expect(saveFeedItem(id)).rejects.toMatchObject({
      tag: 'FeedItemNotFound',
      id,
    });
  });
});

describe('the middleware failures', () => {
  it('maps an empty 401 to Unauthorized and notifies the listener', async () => {
    stubFetch({ status: 401 });

    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    try {
      await expect(getSetting()).rejects.toMatchObject({
        tag: 'Unauthorized',
      });
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
    }
  });

  it('maps an empty 403 to Forbidden', async () => {
    stubFetch({ status: 403 });

    await expect(removeSavedPage(id)).rejects.toMatchObject({
      tag: 'Forbidden',
    });
  });

  it('maps a 500 AuthUnavailable to its tag', async () => {
    stubFetch({ status: 500, body: { _tag: 'AuthUnavailable' } });

    await expect(getSetting()).rejects.toMatchObject({
      tag: 'AuthUnavailable',
    });
  });
});

describe('the transport failures', () => {
  it('maps a request without an answer to NetworkError', async () => {
    failingFetch();

    await expect(getSetting()).rejects.toMatchObject({ tag: 'NetworkError' });
  });

  it('maps a success body that does not decode to InvalidResponse', async () => {
    stubFetch({ status: 200, body: { unexpected: true } });

    await expect(getSetting()).rejects.toMatchObject({
      tag: 'InvalidResponse',
    });
  });

  it('maps an undeclared status to RequestFailed', async () => {
    stubFetch({ status: 418 });

    await expect(getSetting()).rejects.toMatchObject({ tag: 'RequestFailed' });
  });
});

describe('a successful request', () => {
  it('resolves with the decoded success value', async () => {
    stubFetch({
      status: 200,
      body: {
        retention: 100,
        provider: 'jina',
        jinaKeyConfigured: true,
        browserEndpointConfigured: false,
      },
    });

    await expect(getSetting()).resolves.toEqual({
      retention: 100,
      provider: 'jina',
      jinaKeyConfigured: true,
      browserEndpointConfigured: false,
    });
  });

  it('encodes a decoded entity response back to its wire JSON form', async () => {
    const item = {
      id,
      ownerId: 'owner-1',
      url: 'https://example.com/post',
      title: 'Title',
      content: '<p>Body</p>',
      publishedAt: '2026-03-01T12:00:00.000Z',
      read: false,
    };

    stubFetch({ status: 201, body: { item } });

    await expect(addSavedPage('https://example.com/post')).resolves.toEqual({
      item,
    });
  });

  it('sends the cookies to the API of the app origin', async () => {
    const fetchStub = stubFetch({ status: 200, body: { count: 7 } });

    await expect(getSavedPageUnreadCount()).resolves.toEqual({ count: 7 });

    const [url, init] = fetchStub.mock.calls[0] ?? [];

    expect(String(url)).toContain('/api/saved-pages/unread-count');
    expect(init?.credentials).toBe('include');
  });
});
