import {
  extractFeedItem,
  findFeedItem,
  listFeedItems,
  markFeedItems,
  markFeedsRead,
  refreshFeedItems,
  SettingsRepository,
  unreadCounts,
} from '@reader/business';
import { Effect, Option } from 'effect';
import {
  cursor,
  type HandlerRequest,
  optionalCursor,
  optionToNull,
  webpageFetcherLayerFor,
  withSession,
} from './library-contract';
import {
  extractFeedItemFailure,
  feedItemFailure,
  feedItemPageFailure,
  markFeedsFailure,
  unreadCountsFailure,
} from './library-failures';

const feedItems = ({ query }: HandlerRequest<'feedItems'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const after = yield* optionalCursor(query.cursor);

      return yield* listFeedItems(
        owner,
        Option.getOrUndefined(query.feedId),
        Option.getOrElse(query.filter, () => 'all'),
        after
      );
    })
  ).pipe(Effect.catchTags(feedItemPageFailure));

const feedItemsRefresh = ({ query }: HandlerRequest<'feedItemsRefresh'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const through = yield* cursor(query.through);

      return yield* Effect.map(
        refreshFeedItems(
          owner,
          Option.getOrUndefined(query.feedId),
          Option.getOrElse(query.filter, () => 'all'),
          through
        ),
        (items) => ({ items })
      );
    })
  ).pipe(Effect.catchTags(feedItemPageFailure));

const feedItem = ({ query }: HandlerRequest<'feedItem'>) =>
  withSession((owner) =>
    Effect.map(findFeedItem(owner, query.feedId, query.id), (found) => ({
      item: optionToNull(found),
    }))
  ).pipe(Effect.catchTags(feedItemFailure));

const extract = ({ payload }: HandlerRequest<'extractFeedItem'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const settings = yield* SettingsRepository;
      const config = yield* settings.get(owner);

      const item = yield* extractFeedItem(
        owner,
        payload.feedId,
        payload.id
      ).pipe(Effect.provide(webpageFetcherLayerFor(config)));

      return { item };
    })
  ).pipe(Effect.catchTags(extractFeedItemFailure));

const markOne = ({ payload }: HandlerRequest<'markFeedItem'>) =>
  withSession((owner) =>
    markFeedItems(owner, payload.feedId, [payload.id], payload.read).pipe(
      Effect.as({ ok: true as const })
    )
  ).pipe(Effect.catchTags(feedItemFailure));

const markMany = ({ payload }: HandlerRequest<'markFeedItems'>) =>
  withSession((owner) =>
    markFeedItems(owner, payload.feedId, payload.ids, true).pipe(
      Effect.as({ ok: true as const })
    )
  ).pipe(Effect.catchTags(feedItemFailure));

const markFeeds = ({ payload }: HandlerRequest<'markFeedsRead'>) =>
  withSession((owner) =>
    markFeedsRead(owner, payload.feedIds).pipe(Effect.as({ ok: true as const }))
  ).pipe(Effect.catchTags(markFeedsFailure));

const unread = () =>
  withSession((owner) => unreadCounts(owner)).pipe(
    Effect.catchTags(unreadCountsFailure)
  );

export const feedItemHandlers = {
  feedItems,
  feedItemsRefresh,
  feedItem,
  extractFeedItem: extract,
  markFeedItem: markOne,
  markFeedItems: markMany,
  markFeedsRead: markFeeds,
  unreadCounts: unread,
};
