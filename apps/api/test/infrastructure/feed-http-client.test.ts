import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { fetchFeed } from '../../../../packages/business/src/usecase/feed-fetch.ts';
import { FeedHttpClientLive } from '../../src/infrastructure/feed-http-client';

const rss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel><title>News</title></channel>
</rss>`;

type FetchInit = Parameters<typeof globalThis.fetch>[1];
type FetchInput = Parameters<typeof globalThis.fetch>[0];

const fetchWith = (url: URL, fetchImpl: typeof globalThis.fetch) =>
  fetchFeed(url).pipe(
    Effect.provide(FeedHttpClientLive),
    Effect.provideService(FetchHttpClient.Fetch, fetchImpl)
  );

const streamingRedirect = (
  events: Array<string>,
  location: string,
  signal: AbortSignal | null | undefined
): Response => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('redirect'));
    },
    cancel() {
      events.push('cancel:redirect');
    },
  });
  signal?.addEventListener('abort', () => {
    void body.cancel();
  });

  return new Response(body, { status: 302, headers: { location } });
};

it.effect('fetches a feed through the configured public client', () =>
  Effect.gen(function* () {
    let init: (FetchInit & { dispatcher?: unknown }) | undefined;
    const fetchImpl = (_input: RequestInfo | URL, options?: FetchInit) => {
      init = options as typeof init;

      return Promise.resolve(new Response(rss, { status: 200 }));
    };
    const document = yield* fetchWith(
      new URL('http://8.8.8.8/rss'),
      fetchImpl as typeof globalThis.fetch
    );
    expect(document.content).toBe(rss);
    expect(document.url.href).toBe('http://8.8.8.8/rss');
    expect(init?.redirect).toBe('manual');
    expect(init?.dispatcher).toBeDefined();
  })
);

it.effect('rejects a private target before requesting', () =>
  Effect.gen(function* () {
    let called = false;
    const fetchImpl = () => {
      called = true;

      return Promise.resolve(new Response(rss, { status: 200 }));
    };
    const error = yield* Effect.flip(
      fetchWith(
        new URL('http://127.0.0.1/rss'),
        fetchImpl as typeof globalThis.fetch
      )
    );
    expect(error._tag).toBe('FetchSubscriptionError');
    expect(called).toBe(false);
  })
);

it.effect('rejects a redirect to a private target before following', () =>
  Effect.gen(function* () {
    const seen: Array<string> = [];
    const fetchImpl = (input: RequestInfo | URL) => {
      seen.push(String(input));

      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private' },
        })
      );
    };
    const error = yield* Effect.flip(
      fetchWith(
        new URL('http://8.8.8.8/rss'),
        fetchImpl as typeof globalThis.fetch
      )
    );
    expect(error._tag).toBe('FetchSubscriptionError');
    expect(seen).toEqual(['http://8.8.8.8/rss']);
  })
);

it.effect('releases a redirect body before the next request', () =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    const fetchImpl = (input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      events.push(`request:${url}`);

      if (url !== 'http://8.8.8.8/rss') {
        return Promise.resolve(new Response(rss, { status: 200 }));
      }

      return Promise.resolve(
        streamingRedirect(events, 'http://8.8.8.8/final', init?.signal)
      );
    };
    const document = yield* fetchWith(
      new URL('http://8.8.8.8/rss'),
      fetchImpl as typeof globalThis.fetch
    );
    expect(document.url.href).toBe('http://8.8.8.8/final');
    expect(events).toEqual([
      'request:http://8.8.8.8/rss',
      'cancel:redirect',
      'request:http://8.8.8.8/final',
    ]);
  })
);
