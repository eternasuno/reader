import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  expectContent,
  expectDescription,
  expectLink,
  expectNoPublishedAt,
  expectOptional,
  isoOf,
  parseFeed,
} from '../support/feed-parser';
import { atom } from '../support/fixtures';

it.effect(
  'FD-PARSE-3 FD-PARSE-4 FD-PARSE-8 maps the Atom channel and entries',
  () =>
    Effect.gen(function* () {
      const feed = yield* parseFeed(atom);

      expect(feed.title).toBe('Atom News');
      expect(feed.description).toEqual(Option.some('Updates'));
      expect(feed.entries.map((entry) => entry.title)).toEqual([
        'Entry',
        'Untyped',
      ]);

      const [entry, untyped] = feed.entries;
      expectLink(entry, 'https://example.com/e');
      expectDescription(entry, 'Plain summary');
      expectContent(entry, '<p>Body</p>');
      expectLink(untyped, 'https://example.com/t');
      expectContent(untyped, 'plain body');
    })
);

it.effect(
  'FD-PARSE-3 takes the first html alternate, then the first link without a type',
  () =>
    Effect.gen(function* () {
      const feed = yield* parseFeed(
        `<feed xmlns="http://www.w3.org/2005/Atom"><title>Links</title>
          <entry><title>Untyped</title>
            <link rel="alternate" type="application/xhtml+xml" href="https://example.com/xhtml"/>
            <link href="https://example.com/untyped"/></entry>
          <entry><title>Fallback</title>
            <link rel="alternate" type="application/xhtml+xml" href="https://example.com/xhtml"/></entry>
        </feed>`
      );

      expectLink(feed.entries[0], 'https://example.com/untyped');
      expectLink(feed.entries[1], 'https://example.com/xhtml');
    })
);

it.effect('FD-PARSE-4 escapes plain Atom text once and never the title', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Escapes</title>
          <entry><title>&lt;b&gt; &amp; title</title>
            <link href="https://example.com/plain"/>
            <summary type="text">&lt;title&gt; &amp;copy; &amp;amp;</summary>
            <content type="text/plain; charset=utf-8">&lt;b&gt;bold&lt;/b&gt;</content></entry>
          <entry><title>Typed</title><link href="https://example.com/typed"/>
            <summary type="text/html">&lt;i&gt;summary&lt;/i&gt;</summary>
            <content type="image/png">cG5n</content></entry>
        </feed>`
    );

    const [plain, typed] = feed.entries;
    expect(plain?.title).toBe('<b> & title');
    expectDescription(plain, '&lt;title&gt; &amp;copy; &amp;amp;');
    expectContent(plain, '&lt;b&gt;bold&lt;/b&gt;');
    expectDescription(typed, '<i>summary</i>');
    expectOptional(typed, (item) => item.content, Option.none());
  })
);

it.effect('FD-PARSE-4 FD-PARSE-6 drops Atom content that carries a src', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>External</title>
          <entry><title>External</title><link href="https://example.com/external"/>
            <content type="html" src="https://example.com/external.html">&lt;p&gt;ignored&lt;/p&gt;</content></entry>
          <entry><title>Xhtml</title><link href="https://example.com/xhtml"/>
            <content type="application/xhtml+xml"><div xmlns="http://www.w3.org/1999/xhtml"><p>xhtml</p></div></content></entry>
        </feed>`
    );

    expectOptional(feed.entries[0], (item) => item.content, Option.none());
    expectContent(feed.entries[1], '<p>xhtml</p>');
  })
);

it.effect(
  'FD-PARSE-7 uses only published for Atom times and keeps a missing one as none',
  () =>
    Effect.gen(function* () {
      const feed = yield* parseFeed(
        `<feed xmlns="http://www.w3.org/2005/Atom"><title>Dates</title>
          <entry><title>Updated</title><link href="https://example.com/updated"/>
            <updated>2026-01-06T00:00:00Z</updated></entry>
          <entry><title>Published</title><link href="https://example.com/published"/>
            <published>2026-01-07T00:00:00Z</published>
            <updated>2026-01-08T00:00:00Z</updated></entry>
        </feed>`
      );

      expectNoPublishedAt(feed.entries[0]);
      expect(isoOf(feed.entries[1])).toBe('2026-01-07T00:00:00.000Z');
    })
);
