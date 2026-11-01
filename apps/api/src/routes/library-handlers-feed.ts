import { Effect, Option } from 'effect';
import type {
  FeedId,
  OwnerId,
} from '../../../../packages/business/src/entity/model.ts';
import {
  Articles,
  Subscriptions,
} from '../../../../packages/business/src/port/reader-store.ts';
import { Syndication } from '../../../../packages/business/src/port/syndication.ts';
import {
  listFeedArticles,
  refreshFeedArticles,
} from '../../../../packages/business/src/usecase/articles.ts';
import { normalizeUrl } from '../../../../packages/business/src/usecase/identity.ts';
import { subscribe } from '../../../../packages/business/src/usecase/subscriptions.ts';
import { type HandlerRequest, withSession } from './library-contract';
import { subscriptionNotFound } from './library-errors';
import {
  articleReadFailure,
  feedPageFailure,
  previewFailure,
  subscribeFailure,
  subscriptionReadFailure,
  subscriptionWriteFailure,
} from './library-failures';

const preview = (address: string) =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => normalizeUrl(address.trim()),
      catch: () =>
        ({
          _tag: 'SubscriptionUrlInvalid',
          message: 'Subscription URL must use HTTP or HTTPS',
        }) as const,
    });
    const syndication = yield* Syndication;
    const feed = yield* syndication.fetch(url);
    const description = feed.description;

    return {
      preview: {
        url,
        title: feed.title,
        ...(description === undefined ? {} : { description }),
        titles: feed.articles.map((article) => article.title),
      },
    };
  });

const removeSubscription = (owner: OwnerId, id: FeedId) =>
  Effect.gen(function* () {
    const subscriptions = yield* Subscriptions;
    const found = yield* subscriptions.find(owner, id);
    if (Option.isNone(found)) {
      return yield* subscriptionNotFound();
    }

    yield* subscriptions.remove(owner, id);

    return { ok: true as const };
  });

const feedArticles = ({ query }: HandlerRequest<'feedArticles'>) =>
  withSession((owner) =>
    listFeedArticles(
      owner,
      query.feedId,
      query.filter ?? 'all',
      query.cursor,
      query.through
    )
  ).pipe(Effect.catchTags(feedPageFailure));

const feedRefresh = ({ query }: HandlerRequest<'feedRefresh'>) =>
  withSession((owner) =>
    Effect.map(
      refreshFeedArticles(
        owner,
        query.feedId,
        query.filter ?? 'all',
        query.through
      ),
      (items) => ({ items })
    )
  ).pipe(Effect.catchTags(feedPageFailure));

const feeds = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const subscriptions = yield* Subscriptions;

      return { items: yield* subscriptions.list(owner) };
    })
  ).pipe(Effect.catchTags(subscriptionReadFailure));

const previewHandler = ({ payload }: HandlerRequest<'preview'>) =>
  withSession(() => preview(payload.url)).pipe(
    Effect.catchTags(previewFailure)
  );

const subscribeHandler = ({ payload }: HandlerRequest<'subscribe'>) =>
  withSession((owner) => subscribe(owner, payload.url)).pipe(
    Effect.catchTags(subscribeFailure)
  );

const unsubscribe = ({ payload }: HandlerRequest<'unsubscribe'>) =>
  withSession((owner) => removeSubscription(owner, payload.id)).pipe(
    Effect.catchTags({
      ...subscriptionReadFailure,
      ...subscriptionWriteFailure,
    })
  );

const feedsUnread = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const articles = yield* Articles;

      return yield* articles.unreadFeeds(owner);
    })
  ).pipe(Effect.catchTags(articleReadFailure));

export const feedHandlers = {
  feedArticles,
  feedRefresh,
  feeds,
  preview: previewHandler,
  subscribe: subscribeHandler,
  unsubscribe,
  feedsUnread,
};
