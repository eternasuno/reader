import { expect, it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { FetchHttpClient } from 'effect/http';
import {
  fetchPublicText,
  isPublicIPv4,
  parsePublicUrl,
  pinnedAddressLookup,
  selectPublicAddress,
} from '../../src/infrastructure/http-fetch';

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

const request = {
  url: 'http://8.8.8.8/page',
  headers: { accept: 'text/html' },
  maxBytes: 1024,
  maxRedirects: 3,
};

const withFetch =
  (impl: typeof globalThis.fetch) =>
  <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.provideService(FetchHttpClient.Fetch, impl));

const textFetch =
  (body: string, headers: Record<string, string> = {}) =>
  () =>
    Promise.resolve(new Response(body, { status: 200, headers }));

it('rejects unsafe URLs and private or mixed DNS results', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ]) {
    expect(isPublicIPv4(ip)).toBe(false);
  }

  expect(isPublicIPv4('8.8.8.8')).toBe(true);
  expect(() => parsePublicUrl('ftp://example.com/file')).toThrow();
  expect(() => parsePublicUrl('https://user:pass@example.com')).toThrow();
  expect(() => parsePublicUrl('http://example.com:8080')).toThrow();
  expect(parsePublicUrl('https://example.com/path').href).toBe(
    'https://example.com/path'
  );
  expect(selectPublicAddress(['93.184.216.34'])).toBe('93.184.216.34');
  expect(() => selectPublicAddress(['93.184.216.34', '127.0.0.1'])).toThrow();
  expect(() => selectPublicAddress([])).toThrow();
});

it('pins the validated address for single and all lookups', () => {
  const lookup = pinnedAddressLookup('93.184.216.34');
  const calls: unknown[] = [];
  lookup('example.com', { all: true }, (...args) => calls.push(args));
  lookup('example.com', {}, (...args) => calls.push(args));
  expect(calls).toEqual([
    [null, [{ address: '93.184.216.34', family: 4 }]],
    [null, '93.184.216.34', 4],
  ]);
});

it.effect('keeps the public URL and uses a scoped dispatcher', () =>
  Effect.gen(function* () {
    let seen: { url: string; init: FetchInit | undefined } | undefined;
    const fetchImpl = (input: FetchInput, init?: FetchInit) => {
      seen = { url: String(input), init };

      return textFetch('<html>ok</html>')();
    };
    const result = yield* fetchPublicText(request).pipe(
      withFetch(fetchImpl as typeof globalThis.fetch)
    );
    const init = seen?.init as
      | (FetchInit & { dispatcher?: unknown })
      | undefined;
    expect(result.body).toBe('<html>ok</html>');
    expect(seen?.url).toBe('http://8.8.8.8/page');
    expect(init?.redirect).toBe('manual');
    expect(init?.dispatcher).toBeDefined();
  })
);

it.effect('follows three redirects and reports the final address', () =>
  Effect.gen(function* () {
    const responses = [
      new Response(null, {
        status: 302,
        headers: { location: 'http://8.8.8.9/one' },
      }),
      new Response(null, {
        status: 301,
        headers: { location: 'http://1.1.1.1/two' },
      }),
      new Response(null, {
        status: 307,
        headers: { location: 'http://9.9.9.9/three' },
      }),
      new Response('final', { status: 200 }),
    ];
    const seen: string[] = [];
    const fetchImpl = (input: FetchInput) => {
      seen.push(String(input));
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected request');
      }

      return Promise.resolve(response);
    };
    const result = yield* fetchPublicText(request).pipe(
      withFetch(fetchImpl as typeof globalThis.fetch)
    );
    expect(result.body).toBe('final');
    expect(result.url).toBe('http://9.9.9.9/three');
    expect(seen).toEqual([
      'http://8.8.8.8/page',
      'http://8.8.8.9/one',
      'http://1.1.1.1/two',
      'http://9.9.9.9/three',
    ]);
  })
);

it.effect('rejects a redirect to a private address', () =>
  Effect.gen(function* () {
    const redirect = () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private' },
        })
      );
    const seen: string[] = [];
    const fetchImpl = (input: FetchInput) => {
      seen.push(String(input));

      return redirect();
    };
    const error = yield* Effect.flip(
      fetchPublicText(request).pipe(
        withFetch(fetchImpl as typeof globalThis.fetch)
      )
    );
    expect(error._tag).toBe('FetchFailure');
    expect(seen).toEqual(['http://8.8.8.8/page']);
  })
);

it.effect(
  'rejects redirects to prohibited ports or credentials before requesting',
  () =>
    Effect.gen(function* () {
      for (const location of [
        'http://8.8.8.9:8080/next',
        'http://user:pass@8.8.8.9/next',
      ]) {
        const seen: string[] = [];
        const fetchImpl = (input: FetchInput) => {
          seen.push(String(input));

          return Promise.resolve(
            new Response(null, { status: 302, headers: { location } })
          );
        };
        const error = yield* Effect.flip(
          fetchPublicText(request).pipe(
            withFetch(fetchImpl as typeof globalThis.fetch)
          )
        );
        expect(error._tag).toBe('FetchFailure');
        expect(seen).toEqual(['http://8.8.8.8/page']);
      }
    })
);

it.effect('rejects a private address before requesting', () =>
  Effect.gen(function* () {
    let called = false;
    const fetchImpl = () => {
      called = true;

      return Promise.resolve(new Response('x'));
    };
    const error = yield* Effect.flip(
      fetchPublicText({
        ...request,
        url: 'http://127.0.0.1/private',
      }).pipe(withFetch(fetchImpl as typeof globalThis.fetch))
    );
    expect(error._tag).toBe('FetchFailure');
    expect(called).toBe(false);
  })
);

it.effect('fails typed on an invalid or missing redirect location', () =>
  Effect.gen(function* () {
    const invalid = () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://[invalid' },
        })
      );
    const missing = () => Promise.resolve(new Response(null, { status: 302 }));
    const invalidError = yield* Effect.flip(
      fetchPublicText(request).pipe(
        withFetch(invalid as typeof globalThis.fetch)
      )
    );
    const missingError = yield* Effect.flip(
      fetchPublicText(request).pipe(
        withFetch(missing as typeof globalThis.fetch)
      )
    );
    expect(invalidError._tag).toBe('FetchFailure');
    expect(missingError._tag).toBe('FetchFailure');
  })
);

it.effect('stops after three redirects without requesting a fourth', () =>
  Effect.gen(function* () {
    const seen: string[] = [];
    const fetchImpl = (input: FetchInput) => {
      seen.push(String(input));

      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://8.8.8.9/next' },
        })
      );
    };
    const error = yield* Effect.flip(
      fetchPublicText(request).pipe(
        withFetch(fetchImpl as typeof globalThis.fetch)
      )
    );
    expect(error._tag).toBe('FetchFailure');
    expect(seen).toHaveLength(4);
  })
);

it.effect('rejects bodies over the byte limit and cancels the stream', () =>
  Effect.gen(function* () {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(129));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = () => Promise.resolve(new Response(body));
    const error = yield* Effect.flip(
      fetchPublicText({ ...request, maxBytes: 128 }).pipe(
        withFetch(fetchImpl as typeof globalThis.fetch)
      )
    );
    expect(error._tag).toBe('FetchFailure');
    expect(cancelled).toBe(true);
  })
);

it.effect('aborts the request when the parent is interrupted', () =>
  Effect.gen(function* () {
    let signal: AbortSignal | undefined;
    let started = () => {};
    const sent = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      started();

      return new Promise<Response>(() => {});
    };
    const fiber = yield* fetchPublicText(request).pipe(
      withFetch(fetchImpl as typeof globalThis.fetch),
      Effect.forkChild
    );
    yield* Effect.promise(() => sent);
    yield* Fiber.interrupt(fiber);
    expect(signal?.aborted).toBe(true);
  })
);
