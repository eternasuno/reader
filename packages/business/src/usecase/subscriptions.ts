import { Data, DateTime, Effect, Option } from 'effect';
import type { Feed } from '../entity/feed';
import type { FeedId, OwnerId } from '../entity/object-value';
import { ArticleRepository } from '../port/article-repository';
import { FeedParser } from '../port/feed-parser';
import { FeedRepository } from '../port/feed-repository';
import { SettingsRepository } from '../port/settings-repository';
import { fetchFeed } from './feed-fetch';
import { feedId, normalizeUrl } from './identity';
import {
  importArticles,
  initialSelection,
  refreshSelection,
} from './subscription-selection';

export { SUBSCRIPTION_INITIAL_IMPORT } from './subscription-selection';

export class SubscriptionUrlInvalid extends Data.TaggedError(
  'SubscriptionUrlInvalid'
)<{
  readonly message: string;
}> {}

export class SubscriptionExists extends Data.TaggedError('SubscriptionExists')<{
  readonly message: string;
  readonly id: FeedId;
}> {}

export class SubscriptionNotFound extends Data.TaggedError(
  'SubscriptionNotFound'
)<{
  readonly message: string;
  readonly id: FeedId;
}> {}

export class SubscriptionImportFailed extends Data.TaggedError(
  'SubscriptionImportFailed'
)<{
  readonly message: string;
  readonly id: FeedId;
}> {}

export class SubscriptionRefreshFailed extends Data.TaggedError(
  'SubscriptionRefreshFailed'
)<{
  readonly message: string;
  readonly id: FeedId;
}> {}

const existsError = (id: FeedId) =>
  new SubscriptionExists({ message: 'Subscription already exists', id });

const subscriptionUrl = (address: string) =>
  Effect.try({
    try: () => normalizeUrl(address.trim()),
    catch: () =>
      new SubscriptionUrlInvalid({
        message: 'Subscription URL must use HTTP or HTTPS',
      }),
  });

const importErrors = (id: FeedId) => {
  const fail = () =>
    Effect.fail(
      new SubscriptionImportFailed({
        message: 'Failed to import subscription articles',
        id,
      })
    );

  return {
    DocumentSantizeError: fail,
    HtmlParserError: fail,
    ArticleRepositoryError: fail,
  };
};

const refreshErrors = (id: FeedId) => {
  const fail = () =>
    Effect.fail(
      new SubscriptionRefreshFailed({
        message: 'Failed to refresh subscription',
        id,
      })
    );

  return {
    DocumentSantizeError: fail,
    HtmlParserError: fail,
    ArticleRepositoryError: fail,
    FeedRepositoryError: fail,
  };
};

export const subscribe = Effect.fn('subscriptions.subscribe')(function* (
  ownerId: OwnerId,
  address: string
) {
  const url = yield* subscriptionUrl(address);
  const id = feedId(ownerId, url);
  const subscriptions = yield* FeedRepository;
  if (Option.isSome(yield* subscriptions.find(ownerId, id))) {
    return yield* existsError(id);
  }

  const feedParser = yield* FeedParser;
  const document = yield* fetchFeed(url);
  const feed = yield* feedParser.parse(document.content, document.url);
  const now = yield* DateTime.now;
  const subscription: Feed = {
    id,
    ownerId,
    url,
    title: feed.title,
    updatedAt: now,
  };
  if (!(yield* subscriptions.create(ownerId, [subscription])).includes(id)) {
    return yield* existsError(id);
  }

  yield* importArticles(
    ownerId,
    id,
    initialSelection(ownerId, id, feed.articles)
  ).pipe(Effect.catchTags(importErrors(id)));

  return { item: subscription };
});

const readRetention = (ownerId: OwnerId, id: FeedId) =>
  Effect.gen(function* () {
    const settings = yield* SettingsRepository;
    const value = yield* settings.get(ownerId);

    return value.retention;
  }).pipe(
    Effect.mapError(
      () =>
        new SubscriptionRefreshFailed({
          message: 'Failed to refresh subscription',
          id,
        })
    )
  );

export const refreshSubscription = Effect.fn('subscriptions.refresh')(
  function* (ownerId: OwnerId, id: FeedId) {
    const subscriptions = yield* FeedRepository;
    const subscription = yield* subscriptions.find(ownerId, id);
    if (Option.isNone(subscription)) {
      return yield* new SubscriptionNotFound({
        message: 'Subscription not found',
        id,
      });
    }

    const feedParser = yield* FeedParser;
    const document = yield* fetchFeed(subscription.value.url);
    const feed = yield* feedParser.parse(document.content, document.url);
    const now = yield* DateTime.now;
    const articles = yield* ArticleRepository;
    const inventory = yield* articles.inventory(ownerId, id);
    const retention = yield* readRetention(ownerId, id);
    const retained = refreshSelection(
      ownerId,
      id,
      inventory,
      feed.articles
    ).slice(0, retention);
    const updated: Feed = {
      ...subscription.value,
      title: feed.title,
      updatedAt: now,
    };
    const feedPatch = { title: feed.title, updatedAt: now };

    yield* importArticles(ownerId, id, retained).pipe(
      Effect.andThen(
        articles.retain(
          ownerId,
          id,
          retained.map((candidate) => candidate.id)
        )
      ),
      Effect.andThen(subscriptions.update(ownerId, [{ id, feedPatch }])),
      Effect.catchTags(refreshErrors(id))
    );

    return { item: updated };
  }
);
