import { FeedItemId, SavedPageId } from '@reader/business';

const PAGE_SIZE = 30;

type PageQuery = { readonly unreadOnly: boolean; readonly limit: number };

export type SavedPageQuery =
  | PageQuery
  | (PageQuery & { readonly cursor: SavedPageId });

export type FeedItemQuery =
  | PageQuery
  | (PageQuery & { readonly cursor: FeedItemId });

export const savedPageQuery = (
  unreadOnly: boolean,
  cursor: string | undefined
): SavedPageQuery =>
  cursor === undefined
    ? { unreadOnly, limit: PAGE_SIZE }
    : { unreadOnly, limit: PAGE_SIZE, cursor: SavedPageId.make(cursor) };

export const feedItemQuery = (
  unreadOnly: boolean,
  cursor: string | undefined
): FeedItemQuery =>
  cursor === undefined
    ? { unreadOnly, limit: PAGE_SIZE }
    : { unreadOnly, limit: PAGE_SIZE, cursor: FeedItemId.make(cursor) };
