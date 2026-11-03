import { Effect, Option } from 'effect';
import type {
  FeedId,
  OwnerId,
} from '../../../../packages/business/src/entity/object-value.ts';
import { ArticleRepository } from '../../../../packages/business/src/port/article-repository.ts';
import { FeedParser } from '../../../../packages/business/src/port/feed-parser.ts';
import { FeedRepository } from '../../../../packages/business/src/port/feed-repository.ts';
import {
  listFeedArticles,
  refreshFeedArticles,
} from '../../../../packages/business/src/usecase/articles.ts';
import { fetchFeed } from '../../../../packages/business/src/usecase/feed-fetch.ts';
import { normalizeUrl } from '../../../../packages/business/src/usecase/identity.ts';
import { subscribe } from '../../../../packages/business/src/usecase/subscriptions.ts';
import { type HandlerRequest, withSession } from './library-contract';
import { subscriptionNotFound } from './library-errors';
import {
  articleFailure,
  feedPageFailure,
  feedRepositoryFailure,
  previewFailure,
  subscribeFailure,
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
    const feedParser = yield* FeedParser;
    const document = yield* fetchFeed(url);
    const feed = yield* feedParser.parse(document.content, document.url);

    return {
      preview: {
        url,
        title: feed.title,
        description: feed.description,
        titles: feed.articles.map((article) => article.title),
      },
    };
  });

const removeSubscription = (owner: OwnerId, id: FeedId) =>
  Effect.gen(function* () {
    const subscriptions = yield* FeedRepository;
    const found = yield* subscriptions.find(owner, id);
    if (Option.isNone(found)) {
      return yield* subscriptionNotFound();
    }

    yield* subscriptions.remove(owner, [id]);

    return { ok: true as const };
  });

const feedArticles = ({ query }: HandlerRequest<'feedArticles'>) =>
  withSession((owner) =>
    listFeedArticles(
      owner,
      Option.getOrUndefined(query.feedId),
      Option.getOrElse(query.filter, () => 'all'),
      Option.getOrUndefined(query.cursor),
      Option.getOrUndefined(query.through)
    )
  ).pipe(Effect.catchTags(feedPageFailure));

const feedRefresh = ({ query }: HandlerRequest<'feedRefresh'>) =>
  withSession((owner) =>
    Effect.map(
      refreshFeedArticles(
        owner,
        Option.getOrUndefined(query.feedId),
        Option.getOrElse(query.filter, () => 'all'),
        query.through
      ),
      (items) => ({ items })
    )
  ).pipe(Effect.catchTags(feedPageFailure));

const feeds = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const subscriptions = yield* FeedRepository;

      return { items: yield* subscriptions.list(owner) };
    })
  ).pipe(Effect.catchTags(feedRepositoryFailure));

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
    Effect.catchTags(feedRepositoryFailure)
  );

const feedsUnread = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const articles = yield* ArticleRepository;

      return yield* articles.unreadFeeds(owner);
    })
  ).pipe(Effect.catchTags(articleFailure));

export const feedHandlers = {
  feedArticles,
  feedRefresh,
  feeds,
  preview: previewHandler,
  subscribe: subscribeHandler,
  unsubscribe,
  feedsUnread,
};
