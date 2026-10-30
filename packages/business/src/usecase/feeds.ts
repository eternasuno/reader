import { Clock, Effect, Schema } from 'effect';
import {
  prepareInitialImport,
  prepareRefreshImport,
} from '../entity/feed-import';
import { FeedFetcher, FeedPreviewStore, FeedRepository } from '../port/feed';
import { normalizeLink, saveLink } from './links';

const PREVIEW_TTL_MILLIS = 10 * 60 * 1000;

export class InvalidFeed extends Schema.TaggedError<InvalidFeed>()(
  'InvalidFeed',
  { error: Schema.String }
) {}

export class InvalidPreview extends Schema.TaggedError<InvalidPreview>()(
  'InvalidPreview',
  { error: Schema.String }
) {}

export class FeedNotFound extends Schema.TaggedError<FeedNotFound>()(
  'FeedNotFound',
  { error: Schema.String }
) {}

export const listFeeds = Effect.fn('feeds.list')(function* (owner: string) {
  const repository = yield* FeedRepository;

  return { items: yield* repository.list(owner) };
});

export const previewFeed = Effect.fn('feeds.preview')(function* (
  owner: string,
  address: string
) {
  const url = yield* Effect.try({
    try: () => normalizeLink(address),
    catch: () => new InvalidFeed({ error: '请输入有效的订阅地址' }),
  });
  const fetcher = yield* FeedFetcher;
  const parsed = yield* fetcher.fetch(url);
  const previewUrl = parsed.url ?? url;
  const store = yield* FeedPreviewStore;
  const now = yield* Clock.currentTimeMillis;
  const imported = prepareInitialImport(parsed, new Date(now).toISOString());
  const token = yield* store.save(
    {
      owner,
      url: previewUrl,
      imported,
      expiresAt: now + PREVIEW_TTL_MILLIS,
    },
    now
  );

  return {
    preview: {
      token,
      url: previewUrl,
      title: parsed.title,
      description: parsed.description ?? '',
      articleCount: parsed.articles.length,
    },
  };
});

export const subscribeFeed = Effect.fn('feeds.subscribe')(function* (
  owner: string,
  token: string
) {
  const store = yield* FeedPreviewStore;
  const now = yield* Clock.currentTimeMillis;
  const preview = yield* store.find(owner, token, now);
  if (!preview) {
    return yield* new InvalidPreview({ error: '订阅确认已失效，请重新添加' });
  }

  const repository = yield* FeedRepository;
  const timestamp = new Date(now).toISOString();
  const feed = yield* repository.createSubscribed(
    owner,
    preview.url,
    preview.imported,
    timestamp
  );

  return { item: feed };
});

export const refreshFeed = Effect.fn('feeds.refresh')(function* (
  owner: string,
  key: string
) {
  const repository = yield* FeedRepository;
  const feed = yield* repository.find(owner, key);
  if (!feed) {
    return yield* new FeedNotFound({ error: '订阅源不存在' });
  }

  const fetcher = yield* FeedFetcher;
  const parsed = yield* fetcher
    .fetch(feed.url)
    .pipe(
      Effect.tapError((error) => repository.failure(owner, key, error.error))
    );
  const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString();
  yield* repository.sync(
    owner,
    key,
    prepareRefreshImport(parsed, timestamp),
    timestamp
  );

  return { ok: true };
});

export const unsubscribeFeed = Effect.fn('feeds.unsubscribe')(function* (
  owner: string,
  key: string
) {
  const repository = yield* FeedRepository;
  if (!(yield* repository.remove(owner, key))) {
    return yield* new FeedNotFound({ error: '订阅源不存在' });
  }

  return { ok: true };
});

export const listFeedArticles = Effect.fn('feeds.articles')(function* (
  owner: string,
  feedKey: string,
  read: boolean,
  offset: number,
  all = false,
  before = '',
  beforeKey = ''
) {
  const repository = yield* FeedRepository;
  const items = yield* repository.articles(
    owner,
    feedKey,
    read,
    offset,
    31,
    all,
    before,
    beforeKey
  );

  return { items: items.slice(0, 30), hasMore: items.length > 30 };
});

export const markFeedArticle = Effect.fn('feeds.mark')(function* (
  owner: string,
  key: string,
  read: boolean
) {
  const repository = yield* FeedRepository;
  if (!(yield* repository.mark(owner, key, read))) {
    return yield* new FeedNotFound({ error: '文章不存在' });
  }

  return { ok: true };
});

export const markAllFeedArticles = Effect.fn('feeds.markAll')(function* (
  owner: string,
  feedKey: string
) {
  const repository = yield* FeedRepository;
  yield* repository.markAll(owner, feedKey);

  return { ok: true };
});

export const markLoadedFeedArticles = Effect.fn('feeds.markLoaded')(function* (
  owner: string,
  keys: readonly string[]
) {
  const repository = yield* FeedRepository;
  yield* repository.markLoaded(owner, keys);

  return { ok: true };
});

export const saveFeedArticle = Effect.fn('feeds.save')(function* (
  owner: string,
  key: string
) {
  const repository = yield* FeedRepository;
  const article = yield* repository.article(owner, key);
  if (!article) {
    return yield* new FeedNotFound({ error: '文章不存在' });
  }

  return yield* saveLink(owner, article.url);
});

export const refreshSubscriptions = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const subscriptions = yield* repository.subscriptions;
  yield* Effect.forEach(
    subscriptions,
    ({ owner, key }) =>
      refreshFeed(owner, key).pipe(
        Effect.catch((error) => Effect.logWarning('Feed refresh failed', error))
      ),
    { concurrency: 4, discard: true }
  );
});
