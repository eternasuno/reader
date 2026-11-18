import { expect, it } from '@effect/vitest';
import { DocumentSanitizer, HtmlParser } from '@reader/business';
import { Effect, Option } from 'effect';
import { ContentLive } from '../../src/index';
import { parseFeed } from '../support/feed-parser';

const base = new URL('https://example.com/feed.xml');

it.effect(
  'FD-PARSE-4 FD-PARSE-5 escapes plain Atom and JSON text and leaves RSS text as given',
  () =>
    Effect.gen(function* () {
      const atom = yield* parseFeed(
        `<feed xmlns="http://www.w3.org/2005/Atom"><title>Escapes</title>
          <entry><title>Atom</title><link href="https://example.com/atom"/>
            <summary type="text">&lt;title&gt; &amp;copy; &amp; more</summary>
            <content type="text">&lt;b&gt;bold&lt;/b&gt;</content></entry>
        </feed>`
      );
      const json = yield* parseFeed(
        JSON.stringify({
          version: 'https://jsonfeed.org/version/1.1',
          title: 'Escapes',
          items: [
            {
              id: '1',
              url: 'https://example.com/json',
              title: 'JSON',
              summary: '<title> &copy; & more',
              content_text: '<b>bold</b>',
            },
          ],
        })
      );
      const rss = yield* parseFeed(
        `<rss version="2.0"><channel><title>Escapes</title>
          <item><title>RSS</title><link>https://example.com/rss</link>
            <description>&lt;title&gt; &amp;copy; &amp; more</description></item>
        </channel></rss>`
      );

      expect(atom.entries[0]?.description).toEqual(
        Option.some('&lt;title&gt; &amp;copy; &amp; more')
      );
      expect(atom.entries[0]?.content).toEqual(
        Option.some('&lt;b&gt;bold&lt;/b&gt;')
      );
      expect(json.entries[0]?.description).toEqual(
        Option.some('&lt;title&gt; &amp;copy; &amp; more')
      );
      expect(json.entries[0]?.content).toEqual(
        Option.some('&lt;b&gt;bold&lt;/b&gt;')
      );
      expect(rss.entries[0]?.description).toEqual(
        Option.some('<title> &copy; & more')
      );
    })
);

it.effect('FD-PARSE-5 escapes plain text once without decoding entities', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Once',
        items: [
          {
            id: '1',
            url: 'https://example.com/once',
            title: 'Once',
            content_text: '&amp;',
          },
        ],
      })
    );

    expect(feed.entries[0]?.content).toEqual(Option.some('&amp;amp;'));
  })
);

it.effect('FD-PARSE-5 keeps escaped plain text literal after sanitizing', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Literal',
        items: [
          {
            id: '1',
            url: 'https://example.com/literal',
            title: 'Literal',
            content_text: '<title> &copy; & more',
          },
        ],
      })
    );
    const content = Option.getOrUndefined(
      feed.entries[0]?.content ?? Option.none()
    );
    const parser = yield* HtmlParser;
    const sanitizer = yield* DocumentSanitizer;
    const document = yield* parser.parse(content ?? '', base);
    const html = yield* sanitizer.sanitize(document);

    expect(html).toEqual(Option.some('&lt;title&gt; &amp;copy; &amp; more'));
  }).pipe(Effect.scoped, Effect.provide(ContentLive))
);
