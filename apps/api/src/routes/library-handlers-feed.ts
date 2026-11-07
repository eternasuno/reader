import {
  addFeed,
  FeedFetcher,
  type FeedId,
  FeedParser,
  FeedRepository,
  feedId,
  NormalizedUrl,
  type OwnerId,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import { type HandlerRequest, withSession } from './library-contract';
import { feedImportFailed, feedNotFound } from './library-errors';
import {
  feedRepositoryFailure,
  previewFailure,
  subscribeFailure,
} from './library-failures';

const decodeFeedUrl = (address: string) =>
  Schema.decodeEffect(NormalizedUrl)(address).pipe(
    Effect.mapError(
      () =>
        ({
          _tag: 'FeedUrlInvalid',
          message: 'Feed URL must use HTTP or HTTPS',
        }) as const
    )
  );

const preview = (url: NormalizedUrl) =>
  Effect.gen(function* () {
    const feedFetcher = yield* FeedFetcher;
    const feedParser = yield* FeedParser;
    const document = yield* feedFetcher.fetch(url);
    const feed = yield* feedParser.parse(document.content, document.url);

    return {
      preview: {
        url,
        title: feed.title,
        description: feed.description,
        titles: feed.items.map((item) => item.title),
      },
    };
  });

const removeSubscription = (owner: OwnerId, id: FeedId) =>
  Effect.gen(function* () {
    const subscriptions = yield* FeedRepository;
    const found = yield* subscriptions.find(owner, id);
    if (Option.isNone(found)) {
      return yield* feedNotFound();
    }

    yield* subscriptions.remove(owner, [id]);

    return { ok: true as const };
  });

const feeds = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const subscriptions = yield* FeedRepository;

      return { items: yield* subscriptions.list(owner) };
    })
  ).pipe(Effect.catchTags(feedRepositoryFailure));

const previewHandler = ({ payload }: HandlerRequest<'preview'>) =>
  withSession(() => Effect.flatMap(decodeFeedUrl(payload.url), preview)).pipe(
    Effect.catchTags(previewFailure)
  );

const subscribeHandler = ({ payload }: HandlerRequest<'subscribe'>) =>
  withSession((owner) =>
    Effect.flatMap(decodeFeedUrl(payload.url), (url) =>
      addFeed(owner, url).pipe(
        Effect.map((item) => ({ item })),
        Effect.catchTags({
          FeedItemRepositoryError: () =>
            feedImportFailed({ id: feedId(owner, url) }),
          DocumentSanitizerError: () =>
            feedImportFailed({ id: feedId(owner, url) }),
          HtmlParserError: () => feedImportFailed({ id: feedId(owner, url) }),
        })
      )
    )
  ).pipe(Effect.catchTags(subscribeFailure));

const unsubscribe = ({ payload }: HandlerRequest<'unsubscribe'>) =>
  withSession((owner) => removeSubscription(owner, payload.id)).pipe(
    Effect.catchTags(feedRepositoryFailure)
  );

export const feedHandlers = {
  feeds,
  preview: previewHandler,
  subscribe: subscribeHandler,
  unsubscribe,
};
