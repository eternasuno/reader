import type { Option } from 'effect';

/**
 * What a caller of a paged list passes: the filter, the page size it asked for
 * and the cursor of the previous page, none for the first one (CM-PAGE-2,
 * CM-PAGE-3, CM-PAGE-8). Business defines no page size and no upper bound
 * (CM-PAGE-2).
 */
export type PageInput<Id> = {
  readonly unread: boolean;
  readonly limit: number;
  readonly cursor: Option.Option<Id>;
};

/**
 * The query one list use case sends to its repository: the same filter and
 * cursor, and one row more than the caller asked for, so that the extra row
 * tells there is a next page (CM-PAGE-4). Its shape is the one of
 * `SavedPageQuery` and `FeedItemQuery`.
 */
export type PageQuery<Id> = {
  readonly limit: number;
  readonly unread: boolean;
  readonly cursor: Option.Option<Id>;
};

/**
 * One page of a list: the rows, and the id to pass for the next page or `null`
 * when this page is the last one (CM-PAGE-4).
 */
export type Page<Row, Id> = {
  readonly items: ReadonlyArray<Row>;
  readonly cursor: Id | null;
};

/**
 * The repository query for one page: `limit + 1` rows strictly after the
 * cursor, newest first (CM-PAGE-4). The caller passes no owner, scope or
 * filter state in the cursor (CM-PAGE-3) and business does not check that a
 * cursor belongs to the scope it is used with (CM-PAGE-7).
 */
export const pageQuery = <Id>(input: PageInput<Id>): PageQuery<Id> => ({
  limit: input.limit + 1,
  unread: input.unread,
  cursor: input.cursor,
});

/**
 * Cuts the extra row off and reports the cursor: the first `limit` rows, and
 * the id of the last returned row when more than `limit` came back, otherwise
 * `null` (CM-PAGE-4).
 */
export const pageOf = <Id, Row extends { readonly id: Id }>(
  rows: ReadonlyArray<Row>,
  limit: number
): Page<Row, Id> => {
  const items = rows.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    cursor: rows.length > limit && last !== undefined ? last.id : null,
  };
};
