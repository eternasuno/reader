import { expect, it } from '@effect/vitest';
import { LinkTitle } from '@reader/business';
import { Effect, Exit, Fiber } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { LinkTitleLive } from '../../src/adapter/link-title';

const url = 'http://8.8.8.8/page';

const provideFetch = (impl: typeof globalThis.fetch) =>
  Effect.provideService(FetchHttpClient.Fetch, impl);

const htmlFetch =
  (
    body: string,
    headers: Record<string, string> = {
      'content-type': 'text/html',
    }
  ) =>
  () =>
    Promise.resolve(new Response(body, { status: 200, headers }));

it.effect('decodes the title and trims it', () =>
  Effect.gen(function* () {
    const titles = yield* LinkTitle;
    const title = yield* titles
      .fetch(url)
      .pipe(
        provideFetch(
          htmlFetch(
            '<html><head><title>  A &amp; B  </title></head></html>'
          ) as typeof globalThis.fetch
        )
      );
    expect(title).toBe('A & B');
  }).pipe(Effect.provide(LinkTitleLive))
);

it.effect('falls back to the address for unusable pages', () =>
  Effect.gen(function* () {
    const titles = yield* LinkTitle;
    const fetchImpl = (() => {
      const responses = [
        new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
        new Response('a'.repeat(128 * 1024 + 1), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
        new Response('<html><head></head></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ];
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected request');
      }

      return Promise.resolve(response);
    }) as typeof globalThis.fetch;
    const notHtml = yield* titles.fetch(url).pipe(provideFetch(fetchImpl));
    const oversized = yield* titles.fetch(url).pipe(provideFetch(fetchImpl));
    const missing = yield* titles.fetch(url).pipe(provideFetch(fetchImpl));
    expect(notHtml).toBe(url);
    expect(oversized).toBe(url);
    expect(missing).toBe(url);
  }).pipe(Effect.provide(LinkTitleLive))
);

it.effect('falls back to the address after five seconds', () =>
  Effect.gen(function* () {
    const titles = yield* LinkTitle;
    const fiber = yield* titles
      .fetch(url)
      .pipe(
        provideFetch(
          (() => new Promise<Response>(() => {})) as typeof globalThis.fetch
        ),
        Effect.forkChild
      );
    yield* Effect.yieldNow;
    yield* TestClock.adjust('5 seconds');
    expect(yield* Fiber.join(fiber)).toBe(url);
  }).pipe(Effect.provide(LinkTitleLive))
);

it.effect('propagates parent interruption', () =>
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
    const titles = yield* LinkTitle;
    const fiber = yield* titles
      .fetch(url)
      .pipe(
        provideFetch(fetchImpl as typeof globalThis.fetch),
        Effect.forkChild
      );
    yield* Effect.promise(() => sent);
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(signal?.aborted).toBe(true);
  }).pipe(Effect.provide(LinkTitleLive))
);
