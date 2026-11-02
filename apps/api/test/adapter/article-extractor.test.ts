import { expect, it } from '@effect/vitest';
import { ArticleExtractor, HtmlParser } from '@reader/business';
import { type DateTime, Effect, Layer, Schema } from 'effect';
import { ArticleExtractorLive } from '../../src/adapter/article-extractor';
import { HtmlParserLive } from '../../src/adapter/html-parser';

const baseUrl = 'https://example.com/articles/hello';

const sentence =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

const paragraph = (extra = '') =>
  `<p>${sentence.repeat(4)}${extra} ${sentence.repeat(2)}</p>`;

const makeHtml = () =>
  `<!doctype html><html><head><title>Extractor Fixture</title></head><body><main><article><h1>Extractor Fixture</h1>${paragraph('<a href="/relative/path">relative link</a>')}${paragraph('<a href="javascript:alert(1)">evil link</a>')}${paragraph('<img src="/photo.png" alt="photo" onerror="alert(1)">')}${paragraph('<a href="https://alice:secret@example.com/private">credentialed link</a>')}${paragraph('<img src="data:image/png;base64,aGk=" alt="inline">')}<p onclick="alert(1)">${sentence.repeat(6)}</p><script>alert('xss')</script><iframe src="https://evil.example/embed"></iframe></article></main></body></html>`;

const makeMetadataHtml = (publishedTime: string) =>
  `<!doctype html><html><head><title>Metadata Fixture</title><meta name="description" content="A &lt;b&gt;bold&lt;/b&gt; summary &amp;amp; more"><meta property="article:published_time" content="${publishedTime}"></head><body><main><article><h1>Metadata Fixture</h1>${paragraph()}${paragraph()}</article></main></body></html>`;

const untitledHtml = (publishedTime: string) =>
  `<!doctype html><html><head><meta property="article:published_time" content="${publishedTime}"></head><body><main><article>${paragraph()}${paragraph()}</article></main></body></html>`;

const expectNoActiveContent = (content: string | undefined) => {
  expect(content).toEqual(expect.any(String));
  expect(content).not.toContain('<script');
  expect(content).not.toContain('<iframe');
  expect(content).not.toContain('onclick');
  expect(content).not.toContain('onerror');
};

const expectNoUnsafeUrls = (content: string | undefined) => {
  expect(content).toEqual(expect.any(String));
  expect(content).not.toContain('javascript:');
  expect(content).not.toContain('data:');
  expect(content).not.toContain('secret@example.com');
};

const expectResolvedMedia = (content: string | undefined) => {
  expect(content).toEqual(expect.any(String));
  expect(content).toContain('href="https://example.com/relative/path"');
  expect(content).toContain('src="https://example.com/photo.png"');
  expect(content).toContain('target="_blank"');
  expect(content).toContain('rel="noopener noreferrer"');
  expect(content).toContain('loading="lazy"');
  expect(content).toContain('referrerpolicy="no-referrer"');
};

const Live = Layer.mergeAll(HtmlParserLive, ArticleExtractorLive);

const extractHtml = (html: string, sourceUrl: URL = new URL(baseUrl)) =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const extractor = yield* ArticleExtractor;
    const document = yield* parser.parse(html, sourceUrl);

    return yield* extractor.extract(document);
  });

const verifySanitizedOutput = Effect.gen(function* () {
  const result = yield* extractHtml(makeHtml());
  expect(result.title).toBe('Extractor Fixture');
  expectNoActiveContent(result.content);
  expectNoUnsafeUrls(result.content);
  expectResolvedMedia(result.content);
});

const verifyRedirectedBase = Effect.gen(function* () {
  const redirected = new URL('https://mirror.example.com/section/story');
  const result = yield* extractHtml(makeHtml(), redirected);
  expect(result.content).toContain(
    'href="https://mirror.example.com/relative/path"'
  );
  expect(result.content).toContain(
    'src="https://mirror.example.com/photo.png"'
  );
  expectNoUnsafeUrls(result.content);
});

const verifyTypedFailure = Effect.gen(function* () {
  const failure = yield* Effect.flip(extractHtml('<html></html>'));
  expect(failure._tag).toBe('ArticleExtractError');
});

const encodePublishedAt = (publishedAt: DateTime.Utc): string =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(publishedAt);

const verifyMetadata = Effect.gen(function* () {
  const result = yield* extractHtml(
    makeMetadataHtml('2024-05-06T07:08:09.000Z')
  );
  const publishedAt = result.publishedAt;
  expect(result.title).toBe('Metadata Fixture');
  expect(result.description).toBe(
    'A &lt;b&gt;bold&lt;/b&gt; summary &amp; more'
  );
  expect(
    publishedAt === undefined ? undefined : encodePublishedAt(publishedAt)
  ).toBe('2024-05-06T07:08:09.000Z');
});

const verifyUntitledFallback = Effect.gen(function* () {
  const result = yield* extractHtml(untitledHtml('not a date'));
  expect(result.title).toBe('Untitled');
  expect(result.title).not.toContain(baseUrl);
  expect(result.publishedAt).toBeUndefined();
});

it.effect(
  'removes active content and unsafe urls while resolving and hardening media',
  () => verifySanitizedOutput.pipe(Effect.scoped, Effect.provide(Live))
);

it.effect(
  'resolves relative links against the redirected source url and drops unsafe urls',
  () => verifyRedirectedBase.pipe(Effect.scoped, Effect.provide(Live))
);

it.effect('converts extraction failures to typed errors', () =>
  verifyTypedFailure.pipe(Effect.scoped, Effect.provide(Live))
);

it.effect('escapes the description and parses the published time', () =>
  verifyMetadata.pipe(Effect.scoped, Effect.provide(Live))
);

it.effect('falls back to an Untitled title and drops invalid dates', () =>
  verifyUntitledFallback.pipe(Effect.scoped, Effect.provide(Live))
);
