import { Clock, Effect, Redacted } from 'effect';
import {
  ArticleExtractor,
  ArticleFailure,
  ArticleRepository,
  ReaderCredentials,
  WebpageFetcher,
} from '../port/article';

export const credentialStatus = Effect.fn(function* (owner: string) {
  const credentials = yield* ReaderCredentials;

  return { configured: yield* credentials.configured(owner) };
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
  const secret = yield* credentials.get(owner);
  if (!secret) {
    return yield* new ArticleFailure({
      error: '请先在设置中填写 Jina API Key',
    });
  }

  const fetcher = yield* WebpageFetcher;
  const html = yield* fetcher.fetch(url, secret);
  const extractor = yield* ArticleExtractor;
  const content = yield* extractor.extract(html, url);
  const now = yield* Clock.currentTimeMillis;
  const item = { ...content, url, extractedAt: new Date(now).toISOString() };
  yield* repository.save(owner, item);

  return { item, source };
});
