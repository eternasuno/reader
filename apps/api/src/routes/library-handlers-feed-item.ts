import {
  extractItem,
  type FeedItemId,
  FeedItemRepository,
  listItems,
} from '@reader/business';
import { Effect } from 'effect';
import {
  fetcherFor,
  type HandlerRequest,
  optionToNull,
  withSession,
} from './library-contract';
import {
  extractFeedItemFailure,
  feedItemRepositoryFailure,
} from './library-failures';
import { decodeItemScope } from './library-input';

const unread = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FeedItemRepository;
      const counts = yield* repository.unreadCounts(owner);

      return { feeds: counts };
    })
  ).pipe(Effect.catchTags(feedItemRepositoryFailure));

const markFeeds = ({ payload }: HandlerRequest<'markFeedsRead'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FeedItemRepository;
      yield* repository.updateByFeeds(owner, payload.feedIds, { read: true });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(feedItemRepositoryFailure));

const markAll = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FeedItemRepository;
      yield* repository.updateAll(owner, { read: true });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(feedItemRepositoryFailure));

const items = ({ query }: HandlerRequest<'feedItems'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const scope = yield* decodeItemScope(query);

      return yield* listItems(owner, {
        scope,
        unreadOnly: query.unreadOnly,
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
    })
  ).pipe(Effect.catchTags(feedItemRepositoryFailure));

const item = ({ query }: HandlerRequest<'feedItem'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FeedItemRepository;
      const found = yield* repository.find(owner, query.id);

      return { item: optionToNull(found) };
    })
  ).pipe(Effect.catchTags(feedItemRepositoryFailure));

const extract = ({ payload }: HandlerRequest<'extractFeedItem'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const fetcher = yield* fetcherFor(owner);
      const item = yield* extractItem(owner, payload.id).pipe(
        Effect.provide(fetcher)
      );

      return { item };
    })
  ).pipe(Effect.catchTags(extractFeedItemFailure));

const updateRead = (ids: ReadonlyArray<FeedItemId>, read: boolean) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* FeedItemRepository;
      yield* repository.update(owner, ids, { read });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(feedItemRepositoryFailure));

const markOne = ({ payload }: HandlerRequest<'markFeedItem'>) =>
  updateRead([payload.id], payload.read);

const markMany = ({ payload }: HandlerRequest<'markFeedItems'>) =>
  updateRead(payload.ids, true);

export const feedItemHandlers = {
  feedUnread: unread,
  markFeedsRead: markFeeds,
  markAllFeedItems: markAll,
  feedItems: items,
  feedItem: item,
  extractFeedItem: extract,
  markFeedItem: markOne,
  markFeedItems: markMany,
};
