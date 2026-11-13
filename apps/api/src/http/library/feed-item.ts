import {
  extractItem,
  type FeedItemId,
  FeedItemRepository,
  listAllItems,
  listFeedItems,
  listFolderItems,
} from '@reader/business';
import { Effect } from 'effect';
import { extractFeedItemFailure, feedItemRepositoryFailure } from './failures';
import {
  fetcherFor,
  type HandlerRequest,
  handle,
  handleOk,
  optionToNull,
} from './session';

const unread = () =>
  handle(feedItemRepositoryFailure, (owner) =>
    Effect.flatMap(FeedItemRepository, (repository) =>
      Effect.map(repository.unreadCounts(owner), (feeds) => ({ feeds }))
    )
  );

const markFeeds = ({ payload }: HandlerRequest<'markFeedsRead'>) =>
  handleOk(feedItemRepositoryFailure, (owner) =>
    Effect.flatMap(FeedItemRepository, (repository) =>
      repository.markReadByFeeds(owner, payload.feedIds)
    )
  );

const markAll = () =>
  handleOk(feedItemRepositoryFailure, (owner) =>
    Effect.flatMap(FeedItemRepository, (repository) =>
      repository.markAllRead(owner)
    )
  );

const pageOf = (query: {
  readonly unreadOnly: boolean;
  readonly limit: number;
  readonly cursor?: FeedItemId;
}) => ({
  unreadOnly: query.unreadOnly,
  limit: query.limit,
  ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
});

const items = ({ query }: HandlerRequest<'feedItems'>) =>
  handle(feedItemRepositoryFailure, (owner) =>
    listAllItems(owner, pageOf(query))
  );

const itemsByFeed = ({ query }: HandlerRequest<'feedItemsByFeed'>) =>
  handle(feedItemRepositoryFailure, (owner) =>
    listFeedItems(owner, query.feedId, pageOf(query))
  );

const itemsByFolder = ({ query }: HandlerRequest<'feedItemsByFolder'>) =>
  handle(feedItemRepositoryFailure, (owner) =>
    listFolderItems(owner, query.folderId, pageOf(query))
  );

const item = ({ query }: HandlerRequest<'feedItem'>) =>
  handle(feedItemRepositoryFailure, (owner) =>
    Effect.flatMap(FeedItemRepository, (repository) =>
      Effect.map(repository.find(owner, query.id), (found) => ({
        item: optionToNull(found),
      }))
    )
  );

const extract = ({ payload }: HandlerRequest<'extractFeedItem'>) =>
  handle(extractFeedItemFailure, (owner) =>
    Effect.gen(function* () {
      const fetcher = yield* fetcherFor(owner);
      const item = yield* extractItem(owner, payload.id).pipe(
        Effect.provide(fetcher)
      );

      return { item };
    })
  );

const markRead = (ids: ReadonlyArray<FeedItemId>, read: boolean) =>
  handleOk(feedItemRepositoryFailure, (owner) =>
    Effect.flatMap(FeedItemRepository, (repository) =>
      repository.markRead(owner, ids, read)
    )
  );

const markOne = ({ payload }: HandlerRequest<'markFeedItem'>) =>
  markRead([payload.id], payload.read);

const markMany = ({ payload }: HandlerRequest<'markFeedItems'>) =>
  markRead(payload.ids, true);

export const feedItemHandlers = {
  feedUnread: unread,
  markFeedsRead: markFeeds,
  markAllFeedItems: markAll,
  feedItems: items,
  feedItemsByFeed: itemsByFeed,
  feedItemsByFolder: itemsByFolder,
  feedItem: item,
  extractFeedItem: extract,
  markFeedItem: markOne,
  markFeedItems: markMany,
};
