import { FeedItemApi } from '../../contract';
import {
  contractId,
  type EncodedSuccess,
  type ListPage,
  type ListQuery,
  listQuery,
  request,
  requestJson,
} from './client';

/** Feed items (UI: articles): the lists, read marks and extraction (feeds.md). */

const { endpoints } = FeedItemApi;

/** One feed item in its wire (JSON) form. */
export type FeedItem = EncodedSuccess<typeof endpoints.extractFeedItem>['item'];

/** One page of `全部订阅`, newest first (CM-PAGE-1). */
export const listFeedItems = (query: ListQuery): Promise<ListPage<FeedItem>> =>
  requestJson(endpoints.listFeedItems, (client) =>
    client['feed-item'].listFeedItems({ query: listQuery(query) })
  );

/** One feed item by id, `null` when it does not exist for the owner (CM-OWN-3). */
export const getFeedItem = (feedItemId: string) =>
  requestJson(endpoints.getFeedItem, (client) =>
    client['feed-item'].getFeedItem({ params: { id: contractId(feedItemId) } })
  );

/** Marks one feed item read or unread; unknown ids are ignored (CM-PORT-5). */
export const markFeedItem = (feedItemId: string, read: boolean) =>
  request((client) =>
    client['feed-item'].markFeedItem({
      params: { id: contractId(feedItemId) },
      payload: { read },
    })
  );

/** Marks a list of feed items read; an empty list changes nothing (CM-PORT-5). */
export const markFeedItems = (feedItemIds: ReadonlyArray<string>) =>
  request((client) =>
    client['feed-item'].markFeedItems({
      payload: { ids: feedItemIds.map((id) => contractId(id)) },
    })
  );

/** Marks every feed item read. */
export const markAllFeedItems = () =>
  request((client) => client['feed-item'].markAllFeedItems({}));

/** Extracts the article of a feed item and stores it (FD-EXTRACT). */
export const extractFeedItem = (feedItemId: string) =>
  requestJson(endpoints.extractFeedItem, (client) =>
    client['feed-item'].extractFeedItem({
      params: { id: contractId(feedItemId) },
    })
  );
