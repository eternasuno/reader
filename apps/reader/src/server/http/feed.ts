import {
  FeedItemRepository,
  FeedRepository,
  listFeedItems,
  moveFeed as moveFeedUseCase,
  previewFeed,
  subscribeFeed,
} from '@reader/business';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { ReaderApi, Session } from '../../contract';
import { FeedRefreshQueue } from '../refresh/queue';
import { decodeFeedUrl, feedTitleOf, pageInput } from './decode';
import { handle, toContractError } from './errors';

/** The owner's feeds by title, then id; not paged (FD-LIST-3). */
const list = HttpApiBuilder.handler(ReaderApi, 'feed', 'listFeeds', () =>
  handle((owner) =>
    Effect.map(
      Effect.flatMap(FeedRepository, (feeds) => feeds.list(owner)),
      (items) => ({ items: [...items] })
    )
  )
);

/** The preview a subscription is built from; stores nothing (FD-PREVIEW). */
const preview = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'previewFeed',
  ({ payload }) =>
    Effect.gen(function* () {
      const url = yield* decodeFeedUrl(payload.url);
      const result = yield* previewFeed(url).pipe(
        Effect.mapError(toContractError)
      );

      return {
        preview: {
          url,
          title: result.title,
          description: result.description,
          titles: [...result.entryTitles],
        },
      };
    })
);

/** Subscribes and enqueues the new feed, answering at once (FD-SUB, FD-SCHED-7). */
const subscribe = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'subscribeFeed',
  ({ payload }) =>
    Effect.gen(function* () {
      const { ownerId } = yield* Session;
      const url = yield* decodeFeedUrl(payload.url);
      const feed = yield* subscribeFeed(
        ownerId,
        url,
        feedTitleOf(payload.title, url),
        Option.fromNullishOr(payload.folderId)
      ).pipe(Effect.mapError(toContractError));

      yield* Effect.flatMap(FeedRefreshQueue, (queue) =>
        queue.enqueue(ownerId, feed.id)
      );

      return { item: feed };
    })
);

/** Removal of a feed and its items; an unknown id changes nothing (FD-UNSUB). */
const unsubscribe = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'unsubscribeFeed',
  ({ params }) =>
    handle((owner) =>
      Effect.flatMap(FeedRepository, (feeds) =>
        feeds.remove(owner, [params.id])
      )
    )
);

/** Moving a feed into a folder or to the top level (FD-MOVE). */
const move = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'moveFeed',
  ({ params, payload }) =>
    handle((owner) =>
      moveFeedUseCase(owner, params.id, Option.fromNullishOr(payload.folderId))
    )
);

/** One preference written; an unknown feed changes nothing (FD-PREF-2). */
const setReaderMode = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'setFeedReaderMode',
  ({ params, payload }) =>
    handle((owner) =>
      Effect.flatMap(FeedRepository, (feeds) =>
        feeds.setReaderMode(owner, params.id, payload.readerMode)
      )
    )
);

/** One preference written; an unknown feed changes nothing (FD-PREF-2). */
const setOrder = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'setFeedOrder',
  ({ params, payload }) =>
    handle((owner) =>
      Effect.flatMap(FeedRepository, (feeds) =>
        feeds.setOrder(owner, params.id, payload.order)
      )
    )
);

/** Unread items per feed; a feed with none is absent (FD-COUNT-1). */
const unreadCounts = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'feedUnreadCounts',
  () =>
    handle((owner) =>
      Effect.map(
        Effect.flatMap(FeedItemRepository, (items) =>
          items.unreadCounts(owner)
        ),
        (items) => ({ items: [...items] })
      )
    )
);

/** Every item of one feed marked read (FD-READ-2). */
const markRead = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'markFeedRead',
  ({ params }) =>
    handle((owner) =>
      Effect.flatMap(FeedItemRepository, (items) =>
        items.markReadByFeeds(owner, [params.id])
      )
    )
);

/**
 * One page of one feed in the requested order; an unknown feed is an empty
 * page (FD-LIST-2, FD-PREF-3).
 */
const feedItems = HttpApiBuilder.handler(
  ReaderApi,
  'feed',
  'listFeedItemsOfFeed',
  ({ params, query }) =>
    handle((owner) =>
      Effect.map(
        listFeedItems(owner, params.id, pageInput(query), query.order),
        (page) => ({ items: [...page.items], cursor: page.cursor })
      )
    )
);

export const FeedHandlersLive = HttpApiBuilder.group(
  ReaderApi,
  'feed',
  (handlers) =>
    handlers.handleAll({
      listFeeds: list,
      previewFeed: preview,
      subscribeFeed: subscribe,
      unsubscribeFeed: unsubscribe,
      moveFeed: move,
      setFeedReaderMode: setReaderMode,
      setFeedOrder: setOrder,
      feedUnreadCounts: unreadCounts,
      markFeedRead: markRead,
      listFeedItemsOfFeed: feedItems,
    })
);
