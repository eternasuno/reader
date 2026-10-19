import { Clock, Effect, Schema } from 'effect';
import { FeedFetcher, FeedRepository } from '../port/feed';
import { normalizeLink, saveLink } from './links';

export class InvalidFeed extends Schema.TaggedError<InvalidFeed>()(
  'InvalidFeed',
  { error: Schema.String }
) {}

export class DuplicateFeed extends Schema.TaggedError<DuplicateFeed>()(
  'DuplicateFeed',
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

export const subscribeFeed = Effect.fn('feeds.subscribe')(function* (
  owner: string,
  address: string
) {
  const url = yield* Effect.try({
    try: () => normalizeLink(address),
    catch: () => new InvalidFeed({ error: '请输入有效的订阅地址' }),
  });
  const fetcher = yield* FeedFetcher;
  const parsed = yield* fetcher.fetch(url);
  const repository = yield* FeedRepository;
  const feed = yield* repository.create(owner, url, parsed.title);
  if (!feed) {
    return yield* new DuplicateFeed({ error: '已经订阅了这个地址' });
  }

  const now = yield* Clock.currentTimeMillis;
  yield* repository.sync(
    owner,
    feed.key,
    parsed,
    true,
    new Date(now).toISOString()
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
  const now = yield* Clock.currentTimeMillis;
  yield* repository.sync(
    owner,
    key,
    parsed,
    false,
    new Date(now).toISOString()
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
  offset: number
) {
  const repository = yield* FeedRepository;
  const items = yield* repository.articles(owner, feedKey, read, offset, 31);

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
