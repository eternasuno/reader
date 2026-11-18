import { expect, it } from '@effect/vitest';
import { HtmlParser } from '@reader/business';
import { Effect } from 'effect';
import { documentOf, HtmlParserLive } from '../src/html-parser';

const url = new URL('https://example.com/posts/1');

const nextTick = Effect.promise(
  () => new Promise<void>((resolve) => setTimeout(resolve, 20))
);

/** Records whether a timer of the document runs, so a closed window shows. */
const timerIn = (document: Document) => {
  const fired = { value: false };
  document.defaultView?.setTimeout(() => {
    fired.value = true;
  }, 0);

  return fired;
};

it.effect(
  'CM-FETCH-2 CM-HTML-3 parses the text against the given url inside the scope',
  () =>
    Effect.gen(function* () {
      const parser = yield* HtmlParser;

      yield* Effect.scoped(
        Effect.gen(function* () {
          const document = documentOf(
            yield* parser.parse('<p>Hi</p><a href="/next">next</a>', url)
          );

          expect(document.URL).toBe('https://example.com/posts/1');
          expect(document.querySelector('p')?.textContent).toBe('Hi');
          expect(document.querySelector('a')?.getAttribute('href')).toBe(
            '/next'
          );
        })
      );
    }).pipe(Effect.provide(HtmlParserLive))
);

it.effect(
  'CM-FETCH-2 closes the document window when the scope is released',
  () =>
    Effect.gen(function* () {
      const parser = yield* HtmlParser;

      const scheduledAfterRelease = yield* Effect.scoped(
        Effect.gen(function* () {
          const document = documentOf(yield* parser.parse('<p>Hi</p>', url));
          const inside = timerIn(document);
          yield* nextTick;
          expect(inside.value).toBe(true);

          return timerIn(document);
        })
      );

      yield* nextTick;
      expect(scheduledAfterRelease.value).toBe(false);
    }).pipe(Effect.provide(HtmlParserLive))
);
