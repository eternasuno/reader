import { Clock, Effect, Redacted } from 'effect';
import type { ReaderProvider } from '../entity/article';
import { ArticleFailure } from '../entity/article-failure';
import { ArticleExtractor } from '../port/article-extractor';
import { ArticleRepository } from '../port/article-repository';
import { ReaderCredentials } from '../port/reader-credentials';
import { WebpageFetcher } from '../port/webpage-fetcher';

export const credentialStatus = Effect.fn(function* (owner: string) {
  const credentials = yield* ReaderCredentials;
  const provider = yield* credentials.provider(owner);
  const jinaConfigured = yield* credentials.configured(owner);
  const browserEndpoint = (yield* credentials.browserEndpoint(owner)) ?? '';

  return {
    configured:
      provider === 'browser' ? browserEndpoint !== '' : jinaConfigured,
    jinaConfigured,
    provider,
    browserEndpoint,
  };
});

export const saveReaderKey = Effect.fn(function* (
  owner: string,
  value: string
) {
  if (!value.trim() || value.length > 2048 || /[\r\n]/.test(value)) {
    return yield* new ArticleFailure({ error: '请输入有效的 Jina API Key' });
  }

  const credentials = yield* ReaderCredentials;
  yield* credentials.set(owner, Redacted.make(value.trim()));

  return { ok: true };
});

export const removeReaderKey = Effect.fn(function* (owner: string) {
  const credentials = yield* ReaderCredentials;
  yield* credentials.remove(owner);

  return { ok: true };
});

export const saveReaderProvider = Effect.fn(function* (
  owner: string,
  provider: ReaderProvider
) {
  const credentials = yield* ReaderCredentials;
  yield* credentials.setProvider(owner, provider);

  return { ok: true };
});

const browserEndpointProtocols = new Set(['http:', 'https:', 'ws:', 'wss:']);

const isValidBrowserEndpoint = (value: string): boolean => {
  if (value.includes('#')) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    browserEndpointProtocols.has(url.protocol) && !url.username && !url.password
  );
};

export const saveReaderBrowserEndpoint = Effect.fn(function* (
  owner: string,
  endpoint: string
) {
  const value = endpoint.trim();
  if (value.length > 2048 || (value !== '' && !isValidBrowserEndpoint(value))) {
    return yield* new ArticleFailure({ error: '请输入有效的浏览器服务地址' });
  }

  const credentials = yield* ReaderCredentials;
  yield* credentials.setBrowserEndpoint(owner, value);

  return { ok: true };
});

export const readArticle = Effect.fn(function* (
  owner: string,
  kind: 'link' | 'feed',
  key: string,
  refresh: boolean,
  extract: boolean
) {
  const repository = yield* ArticleRepository;
  const source = yield* repository.metadata(owner, kind, key);
  if (!source) {
    return yield* new ArticleFailure({ error: '文章不存在或无权访问' });
  }

  const { url } = source;
  const cached = yield* repository.get(owner, url);
  if (cached && !refresh) {
    return { item: cached, source };
  }

  if (!extract) {
    return { item: null, source };
  }

  const credentials = yield* ReaderCredentials;
  const provider = yield* credentials.provider(owner);
  const secret =
    provider === 'jina' ? yield* credentials.get(owner) : undefined;
  if (provider === 'jina' && !secret) {
    return yield* new ArticleFailure({
      error: '请先在设置中填写 Jina API Key',
    });
  }

  const endpoint =
    provider === 'browser'
      ? yield* credentials.browserEndpoint(owner)
      : undefined;
  if (provider === 'browser' && !endpoint) {
    return yield* new ArticleFailure({
      error: '请先在设置中填写浏览器服务地址',
    });
  }

  const fetcher = yield* WebpageFetcher;
  const html = yield* fetcher.fetch(url, secret, provider, endpoint);
  const extractor = yield* ArticleExtractor;
  const content = yield* extractor.extract(html, url);
  const now = yield* Clock.currentTimeMillis;
  const item = { ...content, url, extractedAt: new Date(now).toISOString() };
  yield* repository.save(owner, item);

  return { item, source };
});
