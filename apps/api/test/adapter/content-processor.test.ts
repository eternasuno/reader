import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { ContentProcessor } from '../../../../packages/business/src/port/content-processor.ts';
import { ContentProcessorLive } from '../../src/adapter/content-processor';

const articleUrl = new URL('https://example.com/posts/1');

it.effect('sanitizes HTML and resolves links against the article URL', () =>
  Effect.gen(function* () {
    const processor = yield* ContentProcessor;
    const html = yield* processor.process(
      '<p onclick="steal()">Hi <a href="/next">next</a></p><script>alert(1)</script>',
      false,
      articleUrl
    );
    expect(html).toContain('<p>Hi ');
    expect(html).toContain(
      '<a href="https://example.com/next" target="_blank" rel="noopener noreferrer">next</a>'
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('steal');
  }).pipe(Effect.provide(ContentProcessorLive))
);

it.effect('escapes plain text content instead of parsing it as HTML', () =>
  Effect.gen(function* () {
    const processor = yield* ContentProcessor;
    const html = yield* processor.process(
      '<b>bold</b> & more',
      true,
      articleUrl
    );
    expect(html).toBe('&lt;b&gt;bold&lt;/b&gt; &amp; more');
  }).pipe(Effect.provide(ContentProcessorLive))
);

it.effect(
  'preserves raw relative links without a base and removes unsafe URLs',
  () =>
    Effect.gen(function* () {
      const processor = yield* ContentProcessor;
      const html = yield* processor.process(
        '<p><a href="/next">next</a><a href="javascript:alert(1)">bad</a></p><img src="images/pic.png">',
        false
      );
      expect(html).toContain(
        '<a href="/next" target="_blank" rel="noopener noreferrer">next</a>'
      );
      expect(html).toContain(
        '<img src="images/pic.png" loading="lazy" referrerpolicy="no-referrer">'
      );
      expect(html).not.toContain('javascript:');
      expect(html).toContain('>bad</a>');
    }).pipe(Effect.provide(ContentProcessorLive))
);
