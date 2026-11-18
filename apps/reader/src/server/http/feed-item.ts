import {
  extractItem,
  FeedItemRepository,
  listAllFeedItems,
} from '@reader/business';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { ReaderApi } from '../../contract';
import { pageInput } from './decode';
import { handle } from './errors';
import { webpageFetcherFor } from './fetcher';

/** One page of `全部订阅` (FD-LIST, CM-PAGE). */
const list = HttpApiBuilder.handler(
  ReaderApi,
  'feed-item',
  'listFeedItems',
  ({ query }) =>
    handle((owner) =>
      Effect.map(listAllFeedItems(owner, pageInput(query)), (page) => ({
        items: [...page.items],
        cursor: page.cursor,
      }))
    )
);

/** One item, `item: null` for an unknown or foreign id (FD-OPEN). */
const get = HttpApiBuilder.handler(
  ReaderApi,
  'feed-item',
  'getFeedItem',
  ({ params }) =>
    handle((owner) =>
      Effect.map(
        Effect.flatMap(FeedItemRepository, (items) =>
          items.find(owner, params.id)
        ),
        (found) => ({ item: Option.getOrNull(found) })
      )
    )
);

/** One item's read state (FD-READ). */
const markOne = HttpApiBuilder.handler(
  ReaderApi,
  'feed-item',
  'markFeedItem',
  ({ params, payload }) =>
    handle((owner) =>
      Effect.flatMap(FeedItemRepository, (items) =>
        items.markRead(owner, [params.id], payload.read)
      )
    )
);

/** The loaded rows marked read; unknown ids are ignored (FD-READ-1). */
const markMany = HttpApiBuilder.handler(
  ReaderApi,
  'feed-item',
  'markFeedItems',
  ({ payload }) =>
    handle((owner) =>
      Effect.flatMap(FeedItemRepository, (items) =>
        items.markRead(owner, payload.ids, true)
      )
    )
);

/** Every item of the owner marked read (FD-READ). */
const markAll = HttpApiBuilder.handler(
  ReaderApi,
  'feed-item',
  'markAllFeedItems',
  () =>
    handle((owner) =>
      Effect.flatMap(FeedItemRepository, (items) => items.markAllRead(owner))
    )
);

/** Extracts and stores one item's article (FD-EXTRACT, CM-FETCH-2). */
const extract = HttpApiBuilder.handler(
  ReaderApi,
  'feed-item',
  'extractFeedItem',
  ({ params }) =>
    handle((owner) =>
      extractItem(owner, params.id).pipe(
        Effect.provide(webpageFetcherFor(owner))
      )
    ).pipe(Effect.map((item) => ({ item })))
);

export const FeedItemHandlersLive = HttpApiBuilder.group(
  ReaderApi,
  'feed-item',
  (handlers) =>
    handlers.handleAll({
      listFeedItems: list,
      getFeedItem: get,
      markFeedItem: markOne,
      markFeedItems: markMany,
      markAllFeedItems: markAll,
      extractFeedItem: extract,
    })
);
