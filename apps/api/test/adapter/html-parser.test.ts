import { expect, it } from '@effect/vitest';
import { HtmlParser } from '@reader/business';
import { Effect } from 'effect';
import { HtmlParserLive } from '../../src/adapter/html-parser';

const articleUrl = new URL('https://example.com/posts/1');

it.effect('parses HTML with the requested base URL', () =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const document = yield* parser.parse('<p>Hello</p>', articleUrl);
    expect(document.URL).toBe(articleUrl.href);
    expect(document.body.innerHTML).toBe('<p>Hello</p>');
  }).pipe(Effect.scoped, Effect.provide(HtmlParserLive))
);

it.effect('keeps escaped text literal when parsing HTML', () =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const document = yield* parser.parse(
      '&lt;title&gt;Plain&lt;/title&gt; &amp;copy;'
    );
    expect(document.body.innerHTML).toBe(
      '&lt;title&gt;Plain&lt;/title&gt; &amp;copy;'
    );
  }).pipe(Effect.scoped, Effect.provide(HtmlParserLive))
);

it.effect('closes the parsed document when its scope ends', () => {
  let fired = false;

  return Effect.gen(function* () {
    const parser = yield* HtmlParser;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const document = yield* parser.parse('<p>Hello</p>');
        const view = document.defaultView;
        expect(view).not.toBeNull();
        view?.setTimeout(() => {
          fired = true;
        }, 5);
      })
    );
    yield* Effect.promise(
      () => new Promise((resolve) => setTimeout(resolve, 50))
    );
    expect(fired).toBe(false);
  }).pipe(Effect.provide(HtmlParserLive));
});
