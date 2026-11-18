import { expect, it } from '@effect/vitest';
import { DocumentSanitizer, HtmlDocument, HtmlParser } from '@reader/business';
import { Effect, Option } from 'effect';
import { ContentLive } from '../src/index';

const articleUrl = new URL('https://example.com/posts/1');

const sanitizeDocument = (html: string) =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const sanitizer = yield* DocumentSanitizer;
    const document = yield* parser.parse(html, articleUrl);

    return yield* sanitizer.sanitize(document);
  }).pipe(Effect.scoped, Effect.provide(ContentLive));

it.effect(
  'CM-HTML-3 removes active content and resolves links against the url',
  () =>
    Effect.gen(function* () {
      const html = Option.getOrThrow(
        yield* sanitizeDocument(
          '<p onclick="steal()">Hi <a href="/next">next</a></p><script>alert(1)</script>'
        )
      );

      expect(html).toContain('<p>Hi ');
      expect(html).toContain(
        '<a href="https://example.com/next" target="_blank">next</a>'
      );
      expect(html).not.toContain('<script');
      expect(html).not.toContain('steal');
    })
);

it.effect('CM-HTML-3 resolves relative links and images against the url', () =>
  Effect.gen(function* () {
    const html = Option.getOrThrow(
      yield* sanitizeDocument(
        '<p><a href="/next">next</a></p><img src="images/pic.png">'
      )
    );

    expect(html).toContain(
      '<a href="https://example.com/next" target="_blank">next</a>'
    );
    expect(html).toContain(
      '<img src="https://example.com/posts/images/pic.png">'
    );
  })
);

it.effect('CM-HTML-2 trims the result and maps empty content to none', () =>
  Effect.gen(function* () {
    expect(yield* sanitizeDocument('  <p>Hi</p>  ')).toEqual(
      Option.some('<p>Hi</p>')
    );
    expect(yield* sanitizeDocument('   ')).toEqual(Option.none());
    expect(yield* sanitizeDocument('<script>alert(1)</script>')).toEqual(
      Option.none()
    );
  })
);

it.effect('CM-HTML-4 reports a document it cannot clean as an error', () =>
  Effect.gen(function* () {
    const sanitizer = yield* DocumentSanitizer;
    const error = yield* Effect.flip(sanitizer.sanitize(HtmlDocument.make({})));

    expect(error).toMatchObject({
      _tag: 'DocumentSanitizerError',
      message: 'Unable to sanitize the document',
    });
  }).pipe(Effect.provide(ContentLive))
);
