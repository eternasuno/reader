import { expect, it } from '@effect/vitest';
import { DocumentSantize, HtmlParser } from '@reader/business';
import { Effect, Layer } from 'effect';
import { DocumentSantizeLive } from '../../src/adapter/document-santize';
import { HtmlParserLive } from '../../src/adapter/html-parser';

const articleUrl = new URL('https://example.com/posts/1');

const Live = Layer.mergeAll(HtmlParserLive, DocumentSantizeLive);

it.effect('sanitizes HTML and resolves links against the article URL', () =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const processor = yield* DocumentSantize;
    const document = yield* parser.parse(
      '<p onclick="steal()">Hi <a href="/next">next</a></p><script>alert(1)</script>',
      articleUrl
    );
    const html = yield* processor.sanitize(document);
    expect(html).toContain('<p>Hi ');
    expect(html).toContain(
      '<a href="https://example.com/next" target="_blank" rel="noopener noreferrer">next</a>'
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('steal');
  }).pipe(Effect.scoped, Effect.provide(Live))
);

it.effect(
  'preserves raw relative links without a base and removes unsafe URLs',
  () =>
    Effect.gen(function* () {
      const parser = yield* HtmlParser;
      const processor = yield* DocumentSantize;
      const document = yield* parser.parse(
        '<p><a href="/next">next</a><a href="javascript:alert(1)">bad</a></p><img src="images/pic.png">'
      );
      const html = yield* processor.sanitize(document);
      expect(html).toContain(
        '<a href="/next" target="_blank" rel="noopener noreferrer">next</a>'
      );
      expect(html).toContain(
        '<img src="images/pic.png" loading="lazy" referrerpolicy="no-referrer">'
      );
      expect(html).not.toContain('javascript:');
      expect(html).toContain('>bad</a>');
    }).pipe(Effect.scoped, Effect.provide(Live))
);
