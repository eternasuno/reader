import { expect, it } from '@effect/vitest';
import { DocumentSanitizer, HtmlParser } from '@reader/business';
import { Effect, Layer, Option } from 'effect';
import { DocumentSanitizerLive } from '../../src/adapter/document-sanitizer';
import { HtmlParserLive } from '../../src/adapter/html-parser';

const articleUrl = new URL('https://example.com/posts/1');

const Live = Layer.mergeAll(HtmlParserLive, DocumentSanitizerLive);

it.effect('sanitizes HTML and resolves links against the article URL', () =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const processor = yield* DocumentSanitizer;
    const document = yield* parser.parse(
      '<p onclick="steal()">Hi <a href="/next">next</a></p><script>alert(1)</script>',
      articleUrl
    );
    const html = Option.getOrThrow(yield* processor.sanitize(document));
    expect(html).toContain('<p>Hi ');
    expect(html).toContain(
      '<a href="https://example.com/next" target="_blank" rel="noopener noreferrer">next</a>'
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('steal');
  }).pipe(Effect.scoped, Effect.provide(Live))
);

it.effect(
  'resolves relative links against the article URL and removes unsafe URLs',
  () =>
    Effect.gen(function* () {
      const parser = yield* HtmlParser;
      const processor = yield* DocumentSanitizer;
      const document = yield* parser.parse(
        '<p><a href="/next">next</a><a href="javascript:alert(1)">bad</a></p><img src="images/pic.png">',
        articleUrl
      );
      const html = Option.getOrThrow(yield* processor.sanitize(document));
      expect(html).toContain(
        '<a href="https://example.com/next" target="_blank" rel="noopener noreferrer">next</a>'
      );
      expect(html).toContain(
        '<img src="https://example.com/posts/images/pic.png" loading="lazy" referrerpolicy="no-referrer">'
      );
      expect(html).not.toContain('javascript:');
      expect(html).toContain('>bad</a>');
    }).pipe(Effect.scoped, Effect.provide(Live))
);

it.effect('trims sanitized HTML and maps empty markup to none', () =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const processor = yield* DocumentSanitizer;
    const padded = yield* parser.parse('  <p>Hi</p>  ', articleUrl);
    const empty = yield* parser.parse('   ', articleUrl);

    expect(yield* processor.sanitize(padded)).toEqual(Option.some('<p>Hi</p>'));
    expect(yield* processor.sanitize(empty)).toEqual(Option.none());
  }).pipe(Effect.scoped, Effect.provide(Live))
);
