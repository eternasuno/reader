import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { fetchLinkTitle } from '../../src/infrastructure/link-title';

const url = 'http://8.8.8.8/page';

const provideFetch = (impl: typeof globalThis.fetch) =>
  Effect.provideService(FetchHttpClient.Fetch, impl);

const htmlResponse = (body: string, type = 'text/html') =>
  Promise.resolve(
    new Response(body, {
      status: 200,
      headers: { 'content-type': type },
    })
  );

it.effect('decodes entities, whitespace and long titles', () =>
  Effect.gen(function* () {
    const decode = provideFetch((() =>
      htmlResponse(
        '<html><head><title>  A &amp; B  </title></head></html>'
      )) as typeof globalThis.fetch);
    const truncate = provideFetch((() =>
      htmlResponse(
        `<html><head><title>${'a'.repeat(600)}</title></head></html>`
      )) as typeof globalThis.fetch);
    const title = yield* fetchLinkTitle(url).pipe(decode);
    const truncated = yield* fetchLinkTitle(url).pipe(truncate);
    expect(title).toBe('A & B');
    expect(truncated).toHaveLength(500);
  })
);

it.effect('fails typed for private, non-html and oversized pages', () =>
  Effect.gen(function* () {
    const responses = [htmlResponse('<html></html>', 'text/plain')];
    const fetchImpl = () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected request');
      }

      return response;
    };
    const privateError = yield* Effect.flip(
      fetchLinkTitle('http://127.0.0.1/private')
    );
    const notHtml = yield* Effect.flip(
      fetchLinkTitle(url).pipe(
        provideFetch(fetchImpl as typeof globalThis.fetch)
      )
    );
    const oversized = yield* Effect.flip(
      fetchLinkTitle(url).pipe(
        provideFetch((() =>
          htmlResponse(
            `<html>${'a'.repeat(128 * 1024)}</html>`
          )) as typeof globalThis.fetch)
      )
    );
    expect(privateError._tag).toBe('FetchFailure');
    expect(notHtml._tag).toBe('FetchFailure');
    expect(oversized._tag).toBe('FetchFailure');
  })
);
