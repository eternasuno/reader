import { expect, it } from '@effect/vitest';
import { DocumentSantize, HtmlParser } from '@reader/business';
import { DateTime, Effect, Layer, Option } from 'effect';
import { DocumentSantizeLive } from '../../src/adapter/document-santize';
import { parseFeed } from '../../src/adapter/feed-parser';
import { HtmlParserLive } from '../../src/adapter/html-parser';

const base = new URL('https://example.com/feed.xml');

const now = DateTime.fromDateUnsafe(new Date('2026-02-01T00:00:00.000Z'));

const Live = Layer.mergeAll(HtmlParserLive, DocumentSantizeLive);

it('escapes explicitly plain Atom and JSON fields and leaves RSS HTML unchanged', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Escapes</title>
    <entry>
      <title>Atom</title>
      <summary type="text">&lt;title&gt; &amp;copy; &amp; more</summary>
      <content type="text">&lt;b&gt;bold&lt;/b&gt;</content>
    </entry>
  </feed>`;
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Escapes',
    items: [
      {
        id: '1',
        title: 'JSON',
        summary: '<title> &copy; & more',
        content_text: '<b>bold</b>',
      },
    ],
  });
  const rss = `<rss version="2.0">
    <channel>
      <title>Escapes</title>
      <item>
        <title>RSS</title>
        <description>&lt;title&gt; &amp;copy; &amp; more</description>
      </item>
    </channel>
  </rss>`;
  const escaped = '&lt;title&gt; &amp;copy; &amp; more';

  const atomEntry = parseFeed(atom, base, now).articles[0];
  const jsonEntry = parseFeed(json, base, now).articles[0];
  const rssEntry = parseFeed(rss, base, now).articles[0];

  expect(atomEntry?.description).toEqual(Option.some(escaped));
  expect(atomEntry?.content).toEqual(Option.some('&lt;b&gt;bold&lt;/b&gt;'));
  expect(jsonEntry?.description).toEqual(Option.some(escaped));
  expect(jsonEntry?.content).toEqual(Option.some('&lt;b&gt;bold&lt;/b&gt;'));
  expect(rssEntry?.description).toEqual(Option.some('<title> &copy; & more'));
});

it('escapes plain text exactly once without decoding existing entities', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Once',
    items: [{ id: '1', title: 'Once', content_text: '&amp;' }],
  });

  expect(parseFeed(json, base, now).articles[0]?.content).toEqual(
    Option.some('&amp;amp;')
  );
});

it.effect('retains escaped plain text literally after DOM sanitization', () =>
  Effect.gen(function* () {
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Literal',
      items: [
        {
          id: '1',
          title: 'Literal',
          content_text: '<title> &copy; & more',
        },
      ],
    });
    const content =
      Option.getOrUndefined<string>(
        parseFeed(json, base, now).articles[0]?.content ?? Option.none()
      ) ?? '';
    const parser = yield* HtmlParser;
    const processor = yield* DocumentSantize;
    const document = yield* parser.parse(content, base);
    const html = yield* processor.sanitize(document);

    expect(html).toEqual(Option.some('&lt;title&gt; &amp;copy; &amp; more'));
  }).pipe(Effect.scoped, Effect.provide(Live))
);
