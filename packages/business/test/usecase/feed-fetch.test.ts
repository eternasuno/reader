import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { FetchHttpClient, type HttpClient } from 'effect/http';
import { fetchFeed } from '../../src/usecase/feed-fetch';

const rss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel><title>News</title></channel>
</rss>`;

type Fetch = typeof globalThis.fetch;

type FetchInit = Parameters<Fetch>[1];

type FetchInput = Parameters<Fetch>[0];

const withFetch =
  (fetchImpl: Fetch) =>
  <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetchImpl)
    );

const feedUrl = new URL('http://8.8.8.8/rss');

const trackedResponse = (
  events: Array<string>,
  label: string,
  init: ResponseInit,
  signal: AbortSignal | null | undefined
): Response => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(label));
    },
    cancel() {
      events.push(`cancel:${label}`);
    },
  });
  signal?.addEventListener('abort', () => {
    void body.cancel();
  });

  return new Response(body, init);
};

const redirectResponse = (
  events: Array<string>,
  location: string,
  status = 302,
  signal?: AbortSignal | null
) =>
  trackedResponse(events, location, { status, headers: { location } }, signal);

it.effect('fetches a feed and reports its address', () =>
  Effect.gen(function* () {
    const requests: Array<string> = [];
    const fetchImpl = (input: FetchInput) => {
      requests.push(String(input));

      return Promise.resolve(new Response(rss, { status: 200 }));
    };
    const document = yield* fetchFeed(feedUrl).pipe(
      withFetch(fetchImpl as Fetch)
    );
    expect(document.content).toBe(rss);
    expect(document.url.href).toBe('http://8.8.8.8/rss');
    expect(requests).toEqual(['http://8.8.8.8/rss']);
  })
);

it.effect('follows the supported redirect statuses to the final address', () =>
  Effect.gen(function* () {
    for (const status of [301, 302, 303, 307, 308]) {
      const requests: Array<string> = [];
      const fetchImpl = (input: FetchInput) => {
        const url = String(input);
        requests.push(url);

        return Promise.resolve(
          url.endsWith('/rss')
            ? new Response(null, {
                status,
                headers: { location: 'http://8.8.8.8/final' },
              })
            : new Response(rss, { status: 200 })
        );
      };
      const document = yield* fetchFeed(feedUrl).pipe(
        withFetch(fetchImpl as Fetch)
      );
      expect(document.content).toBe(rss);
      expect(document.url.href).toBe('http://8.8.8.8/final');
      expect(requests).toEqual(['http://8.8.8.8/rss', 'http://8.8.8.8/final']);
    }
  })
);

it.effect('rejects other redirect statuses without another request', () =>
  Effect.gen(function* () {
    for (const status of [300, 304]) {
      const requests: Array<string> = [];
      const fetchImpl = (input: FetchInput) => {
        requests.push(String(input));

        return Promise.resolve(
          new Response(null, {
            status,
            headers: { location: 'http://8.8.8.8/final' },
          })
        );
      };
      const error = yield* Effect.flip(
        fetchFeed(feedUrl).pipe(withFetch(fetchImpl as Fetch))
      );
      expect(error._tag).toBe('FetchSubscriptionError');
      expect(requests).toEqual(['http://8.8.8.8/rss']);
    }
  })
);

it.effect('stops after three redirects without a fourth request', () =>
  Effect.gen(function* () {
    const requests: Array<string> = [];
    const fetchImpl = (input: FetchInput) => {
      requests.push(String(input));

      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://8.8.8.8/next' },
        })
      );
    };
    const error = yield* Effect.flip(
      fetchFeed(feedUrl).pipe(withFetch(fetchImpl as Fetch))
    );
    expect(error._tag).toBe('FetchSubscriptionError');
    expect(requests).toHaveLength(4);
  })
);

it.effect('releases a redirect body before the next request', () =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    const fetchImpl = (input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      events.push(`request:${url}`);

      return Promise.resolve(
        url === 'http://8.8.8.8/rss'
          ? redirectResponse(events, 'http://8.8.8.8/final', 307, init?.signal)
          : new Response(rss, { status: 200 })
      );
    };
    const document = yield* fetchFeed(feedUrl).pipe(
      withFetch(fetchImpl as Fetch)
    );
    expect(document.url.href).toBe('http://8.8.8.8/final');
    expect(events).toEqual([
      'request:http://8.8.8.8/rss',
      'cancel:http://8.8.8.8/final',
      'request:http://8.8.8.8/final',
    ]);
  })
);

it.effect('releases a failing response body and aborts its request', () =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    let aborted = false;
    const fetchImpl = (_input: FetchInput, init?: FetchInit) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => {
        aborted = true;
      });

      return Promise.resolve(
        trackedResponse(events, 'error', { status: 500 }, signal)
      );
    };
    const error = yield* Effect.flip(
      fetchFeed(feedUrl).pipe(withFetch(fetchImpl as Fetch))
    );
    expect(error._tag).toBe('FetchSubscriptionError');
    expect(events).toEqual(['cancel:error']);
    expect(aborted).toBe(true);
  })
);

it.effect('releases an endless body once the byte limit is exceeded', () =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    let pulls = 0;
    let aborted = false;
    const fetchImpl = (_input: FetchInput, init?: FetchInit) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => {
        aborted = true;
      });

      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(64 * 1024));
        },
        cancel() {
          events.push('cancel:endless');
        },
      });

      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const error = yield* Effect.flip(
      fetchFeed(feedUrl).pipe(withFetch(fetchImpl as Fetch))
    );
    expect(error._tag).toBe('FetchSubscriptionError');
    expect(events).toEqual(['cancel:endless']);
    expect(pulls).toBeLessThan(64);
    expect(aborted).toBe(true);
  })
);

it.effect('aborts the request once the feed is read', () =>
  Effect.gen(function* () {
    let aborted = false;
    const fetchImpl = (_input: FetchInput, init?: FetchInit) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
      });

      return Promise.resolve(new Response(rss, { status: 200 }));
    };
    yield* fetchFeed(feedUrl).pipe(withFetch(fetchImpl as Fetch));
    expect(aborted).toBe(true);
  })
);
