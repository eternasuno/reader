import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { stripCredentials, withBasicAuthorization } from '../src/credentials';
import { fetchPublicText } from '../src/http';

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

const basic = (credentials: string) =>
  `Basic ${Buffer.from(credentials).toString('base64')}`;

it('strips credentials and encodes them as basic auth', () => {
  const target = stripCredentials(
    new URL('https://al%40ice:se%3Acret@example.com/a')
  );
  expect(target.url.href).toBe('https://example.com/a');
  expect(target.authorization).toBe(basic('al@ice:se:cret'));

  const plain = new URL('https://example.com/a');
  expect(stripCredentials(plain)).toEqual({
    url: plain,
    authorization: undefined,
  });
  expect(
    withBasicAuthorization({ authorization: 'Bearer token' }, 'Basic x')
  ).toEqual({ authorization: 'Bearer token' });
  expect(withBasicAuthorization({ accept: 'text/html' }, 'Basic x')).toEqual({
    accept: 'text/html',
    authorization: 'Basic x',
  });
});

it.effect('sends url credentials as basic auth', () =>
  Effect.gen(function* () {
    let seen: { url: string; headers: Headers } | undefined;
    const fetchImpl = (input: FetchInput, init?: FetchInit) => {
      seen = { url: String(input), headers: new Headers(init?.headers) };

      return Promise.resolve(new Response('<html>ok</html>', { status: 200 }));
    };
    const result = yield* fetchPublicText({
      ...request,
      url: 'http://alice:secret@8.8.8.8/page',
    }).pipe(withFetch(fetchImpl as typeof globalThis.fetch));
    expect(result.body).toBe('<html>ok</html>');
    expect(result.url).toBe('http://alice:secret@8.8.8.8/page');
    expect(seen?.url).toBe('http://8.8.8.8/page');
    expect(seen?.headers.get('authorization')).toBe(basic('alice:secret'));
  })
);

it.effect('keeps an explicit authorization header over url credentials', () =>
  Effect.gen(function* () {
    let headers: Headers | undefined;
    const fetchImpl = (_input: FetchInput, init?: FetchInit) => {
      headers = new Headers(init?.headers);

      return Promise.resolve(new Response('<html>ok</html>', { status: 200 }));
    };
    yield* fetchPublicText({
      ...request,
      url: 'http://alice:secret@8.8.8.8/page',
      headers: { accept: 'text/html', authorization: 'Bearer token' },
    }).pipe(withFetch(fetchImpl as typeof globalThis.fetch));
    expect(headers?.get('authorization')).toBe('Bearer token');
  })
);

it.effect('follows a credentialed redirect with basic auth', () =>
  Effect.gen(function* () {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = (input: FetchInput, init?: FetchInit) => {
      const url = String(input);
      seen.push({
        url,
        authorization: new Headers(init?.headers).get('authorization'),
      });

      return Promise.resolve(
        url === 'http://8.8.8.8/page'
          ? new Response(null, {
              status: 302,
              headers: { location: 'http://alice:secret@8.8.8.9/next' },
            })
          : new Response('final', { status: 200 })
      );
    };
    const result = yield* fetchPublicText(request).pipe(
      withFetch(fetchImpl as typeof globalThis.fetch)
    );
    expect(result.body).toBe('final');
    expect(result.url).toBe('http://alice:secret@8.8.8.9/next');
    expect(seen).toEqual([
      { url: 'http://8.8.8.8/page', authorization: null },
      { url: 'http://8.8.8.9/next', authorization: basic('alice:secret') },
    ]);
  })
);
