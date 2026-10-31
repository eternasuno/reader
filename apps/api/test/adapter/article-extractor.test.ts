import { expect, it } from '@effect/vitest';
import { ArticleExtractor } from '@reader/business';
import { type DateTime, Effect, Schema } from 'effect';
import { ArticleExtractorLive } from '../../src/adapter/article-extractor';

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

const expectNoActiveContent = (html: string) => {
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('onclick');
  expect(html).not.toContain('onerror');
};

const expectNoUnsafeUrls = (html: string) => {
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('data:');
  expect(html).not.toContain('secret@example.com');
};

const expectResolvedMedia = (html: string) => {
  expect(html).toContain('href="https://example.com/relative/path"');
  expect(html).toContain('src="https://example.com/photo.png"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('referrerpolicy="no-referrer"');
};

const verifySanitizedOutput = Effect.gen(function* () {
  const extractor = yield* ArticleExtractor;
  const result = yield* extractor.extract(makeHtml(), baseUrl);
  expect(result.title).toBe('Extractor Fixture');
  expectNoActiveContent(result.html);
  expectNoUnsafeUrls(result.html);
  expectResolvedMedia(result.html);
});

const verifyTypedFailure = Effect.gen(function* () {
  const extractor = yield* ArticleExtractor;
  const failure = yield* Effect.flip(
    extractor.extract('<html></html>', baseUrl)
  );
  expect(failure._tag).toBe('ArticleExtractError');
});

const encodePublishedAt = (publishedAt: DateTime.Utc): string =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(publishedAt);

const verifyMetadata = Effect.gen(function* () {
  const extractor = yield* ArticleExtractor;
  const result = yield* extractor.extract(
    makeMetadataHtml('2024-05-06T07:08:09.000Z'),
    baseUrl
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
  const extractor = yield* ArticleExtractor;
  const result = yield* extractor.extract(untitledHtml('not a date'), baseUrl);
  expect(result.title).toBe('Untitled');
  expect(result.title).not.toContain(baseUrl);
  expect(result.publishedAt).toBeUndefined();
});

it.effect(
  'removes active content and unsafe urls while resolving and hardening media',
  () => verifySanitizedOutput.pipe(Effect.provide(ArticleExtractorLive))
);

it.effect('converts extraction failures to typed errors', () =>
  verifyTypedFailure.pipe(Effect.provide(ArticleExtractorLive))
);

it.effect('escapes the description and parses the published time', () =>
  verifyMetadata.pipe(Effect.provide(ArticleExtractorLive))
);

it.effect('falls back to an Untitled title and drops invalid dates', () =>
  verifyUntitledFallback.pipe(Effect.provide(ArticleExtractorLive))
);
