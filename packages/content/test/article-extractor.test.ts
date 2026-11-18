import { expect, it } from '@effect/vitest';
import { ArticleExtractor, HtmlDocument, HtmlParser } from '@reader/business';
import { type DateTime, Effect, Option, Schema } from 'effect';
import { ContentLive } from '../src/index';

const articleUrl = new URL('https://example.com/articles/hello');

const sentence =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

const paragraph = () =>
  `<p>${sentence.repeat(4)}</p><p>${sentence.repeat(2)}</p>`;

const articleHtml = `<!doctype html><html><head><title>Extractor Fixture</title></head>
  <body><main><article><h1>Extractor Fixture</h1>
    ${paragraph()}
    <p>${sentence.repeat(2)}<a href="/relative/path">relative link</a></p>
    <p><img src="/photo.png" alt="photo" onerror="alert(1)"></p>
    <p onclick="alert(1)">${sentence.repeat(4)}</p>
    <script>alert('xss')</script><iframe src="https://evil.example/embed"></iframe>
  </article></main></body></html>`;

const metadataHtml = `<!doctype html><html><head><title>Metadata Fixture</title>
  <meta name="description" content="A &lt;b&gt;bold&lt;/b&gt; summary &amp;amp; more">
  <meta property="article:published_time" content="2024-05-06T07:08:09.000Z">
  </head><body><main><article><h1>Metadata Fixture</h1>${paragraph()}</article></main></body></html>`;

const extract = (html: string, url: URL = articleUrl) =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const extractor = yield* ArticleExtractor;
    const document = yield* parser.parse(html, url);

    return yield* extractor.extract(document);
  }).pipe(Effect.scoped, Effect.provide(ContentLive));

const contentOf = (content: Option.Option<string>) =>
  Option.getOrThrow(content);

const isoOf = (publishedAt: Option.Option<DateTime.Utc>) =>
  Option.match(publishedAt, {
    onNone: () => undefined,
    onSome: (published) =>
      Schema.encodeSync(Schema.DateTimeUtcFromString)(published),
  });

it.effect(
  'CM-FETCH-3 extracts the title and sanitized content with resolved media',
  () =>
    Effect.gen(function* () {
      const article = yield* extract(articleHtml);
      const html = contentOf(article.content);

      expect(article.title).toBe('Extractor Fixture');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('onclick');
      expect(html).not.toContain('onerror');
      expect(html).toContain('href="https://example.com/relative/path"');
      expect(html).toContain('src="https://example.com/photo.png"');
      expect(html).toContain('target="_blank"');
    })
);

it.effect(
  'CM-FETCH-3 resolves relative media against the url of the document',
  () =>
    Effect.gen(function* () {
      const article = yield* extract(
        articleHtml,
        new URL('https://mirror.example.com/section/story')
      );
      const html = contentOf(article.content);

      expect(html).toContain('href="https://mirror.example.com/relative/path"');
      expect(html).toContain('src="https://mirror.example.com/photo.png"');
    })
);

it.effect(
  'CM-FETCH-1 CM-FETCH-3 escapes the description and reads the time',
  () =>
    Effect.gen(function* () {
      const article = yield* extract(metadataHtml);

      expect(article.title).toBe('Metadata Fixture');
      expect(article.description).toEqual(
        Option.some('A &lt;b&gt;bold&lt;/b&gt; summary &amp; more')
      );
      expect(isoOf(article.publishedAt)).toBe('2024-05-06T07:08:09.000Z');
    })
);

it.effect('CM-FETCH-1 keeps a missing or unreadable publish time as none', () =>
  Effect.gen(function* () {
    const article = yield* extract(
      `<html><head><title>Missing metadata</title>
        <meta property="article:published_time" content="not a date"></head>
      <body><article><h2>${sentence.repeat(12)}</h2></article></body></html>`
    );

    expect(article.description).toEqual(Option.none());
    expect(article.publishedAt).toEqual(Option.none());
  })
);

it.effect('CM-ART-5 reports the content of an empty page as none', () =>
  Effect.gen(function* () {
    const article = yield* extract('<html><body></body></html>');

    expect(article.title).toBe('Untitled');
    expect(article.content).toEqual(Option.none());
  })
);

it.effect('CM-FETCH-4 reports a document it cannot read as an error', () =>
  Effect.gen(function* () {
    const extractor = yield* ArticleExtractor;
    const error = yield* Effect.flip(extractor.extract(HtmlDocument.make({})));

    expect(error).toMatchObject({
      _tag: 'ArticleExtractorError',
      message: 'Unable to extract the article from the document',
    });
  }).pipe(Effect.provide(ContentLive))
);
