import { FeedApi } from '../../contract';
import {
  contractId,
  type EncodedSuccess,
  type ListPage,
  type ListQuery,
  listQuery,
  request,
  requestJson,
} from './client';
import type { FeedItem } from './feed-item';

/** Feeds: subscribing, the feed list, unread counts and the single-feed list (feeds.md). */

const { endpoints } = FeedApi;

/** One subscription in its wire (JSON) form (feeds.md API). */
export type Feed = EncodedSuccess<typeof endpoints.subscribeFeed>['item'];

/** The preview of a subscription in its wire (JSON) form (feeds.md API). */
export type FeedPreview = EncodedSuccess<
  typeof endpoints.previewFeed
>['preview'];

/** Every feed of the owner, with its folder (FD-LIST). */
export const listFeeds = () =>
  requestJson(endpoints.listFeeds, (client) => client.feed.listFeeds({}));

/** Fetches and parses a source without subscribing (FD-SUB, FD-PARSE). */
export const previewFeed = (url: string) =>
  requestJson(endpoints.previewFeed, (client) =>
    client.feed.previewFeed({ payload: { url } })
  );

/** Subscribes to a source; a duplicate answers `FeedAlreadyExists` (FD-SUB-2). */
export const subscribeFeed = (feed: {
  readonly url: string;
  readonly title?: string | undefined;
  readonly folderId?: string | undefined;
}) =>
  requestJson(endpoints.subscribeFeed, (client) =>
    client.feed.subscribeFeed({
      payload: {
        url: feed.url,
        ...(feed.title === undefined ? {} : { title: feed.title }),
        ...(feed.folderId === undefined
          ? {}
          : { folderId: contractId(feed.folderId) }),
      },
    })
  );

/** Unsubscribes and deletes the feed's items; saved pages stay (FD-UNSUB). */
export const unsubscribeFeed = (feedId: string) =>
  request((client) =>
    client.feed.unsubscribeFeed({ params: { id: contractId(feedId) } })
  );

/** Moves a feed into a folder, or out of any folder with `null` (FD-MOVE). */
export const moveFeed = (feedId: string, folderId: string | null) =>
  request((client) =>
    client.feed.moveFeed({
      params: { id: contractId(feedId) },
      payload: {
        folderId: folderId === null ? null : contractId(folderId),
      },
    })
  );

/** The unread count of every feed (LIB-COUNT). */
export const getFeedUnreadCounts = () =>
  requestJson(endpoints.feedUnreadCounts, (client) =>
    client.feed.feedUnreadCounts({})
  );

/** Marks every item of one feed read (LIB-READ-5: never disabled). */
export const markFeedRead = (feedId: string) =>
  request((client) =>
    client.feed.markFeedRead({ params: { id: contractId(feedId) } })
  );

/** One page of a single feed's items, newest first (CM-PAGE-1). */
export const listFeedItemsOfFeed = (
  feedId: string,
  query: ListQuery
): Promise<ListPage<FeedItem>> =>
  requestJson(endpoints.listFeedItemsOfFeed, (client) =>
    client.feed.listFeedItemsOfFeed({
      params: { id: contractId(feedId) },
      query: listQuery(query),
    })
  );
