import { Effect, Option } from 'effect';
import { ArticleContent } from '../../../entity/common/article';
import type { OwnerId } from '../../../entity/common/owner-id';
import type { Feed, FeedReaderMode } from '../../../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../../../entity/feed-item/feed-item';
import type {
  SavedPage,
  SavedPageId,
} from '../../../entity/saved-page/saved-page';
import type { EbookChapter } from '../../../port/epub-builder';
import { FeedItemRepository } from '../../../port/feed-item-repository';
import { FeedRepository } from '../../../port/feed-repository';
import { SavedPageRepository } from '../../../port/saved-page-repository';
import { extractItem } from '../../feed-item/extract-item';

/** Everything unread, as one page: the ports define no page size (CM-PAGE-2). */
const unreadQuery = {
  limit: Number.MAX_SAFE_INTEGER,
  unread: true,
  cursor: Option.none(),
};

/** The row a chapter came from, marked read once its mail is out (KD-SEND-3). */
export type ArticleRef =
  | { readonly kind: 'feed-item'; readonly id: FeedItemId }
  | { readonly kind: 'saved-page'; readonly id: SavedPageId };

/** One article of the send: its chapter and the row behind it, in book order. */
export type BookArticle = {
  readonly chapter: EbookChapter;
  readonly ref: ArticleRef;
};

/** Ids compare in byte order, oldest first (KD-BOOK-2). */
const compareIds = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

/** `extracted` and `embedded` read the extracted article (KD-TEXT-3, FD-PREF-1). */
const isExtracted = (mode: FeedReaderMode): boolean =>
  mode === 'extracted' || mode === 'embedded';

/** The item's own content, else its description, else nothing (KD-TEXT-2). */
const fallbackText = (item: FeedItem): Option.Option<ArticleContent> =>
  Option.orElse(item.content, () =>
    Option.map(item.description, (description) =>
      ArticleContent.make(description)
    )
  );

/**
 * The text of an item of an `extracted` or `embedded` feed (KD-TEXT-3): the
 * stored extraction without fetching, otherwise one extraction that stores what
 * it extracted. A failed extraction falls back to KD-TEXT-2 (KD-TEXT-4).
 */
const extractedText = Effect.fnUntraced(function* (
  owner: OwnerId,
  item: FeedItem
) {
  if (Option.isSome(item.extractedContent)) {
    return item.extractedContent;
  }

  const extracted = yield* Effect.option(extractItem(owner, item.id));

  return Option.orElse(
    Option.flatMap(extracted, (row) => row.extractedContent),
    () => fallbackText(item)
  );
});

/** The text of one feed item, chosen by its feed's reader mode (KD-TEXT). */
const textOf = Effect.fnUntraced(function* (
  owner: OwnerId,
  item: FeedItem,
  feed: Option.Option<Feed>
) {
  if (Option.exists(feed, (row) => isExtracted(row.readerMode))) {
    return yield* extractedText(owner, item);
  }

  return fallbackText(item);
});

/** The saved pages first, oldest first (KD-BOOK-2, KD-BOOK-3). */
const savedPageArticles = (
  pages: ReadonlyArray<SavedPage>
): ReadonlyArray<BookArticle> =>
  [...pages].reverse().map((page) => ({
    chapter: {
      title: page.title,
      source: '稍后阅读',
      url: page.url,
      publishedAt: page.publishedAt,
      content: Option.some(page.content),
    },
    ref: { kind: 'saved-page', id: page.id },
  }));

/**
 * The items grouped by feed in the feed list's order, each group in its feed's
 * stored order: oldest first under `oldest`, newest first under `newest`
 * (FD-PREF-3). An item whose feed is not found comes last, oldest first
 * (KD-BOOK-2, KD-TEXT-5).
 */
const orderedByFeed = (
  items: ReadonlyArray<FeedItem>,
  feeds: ReadonlyArray<Feed>
): ReadonlyArray<FeedItem> => {
  const rank = new Map<string, number>(
    feeds.map((feed, index) => [feed.id, index])
  );
  const newest = new Set<string>(
    feeds.filter((feed) => feed.order === 'newest').map((feed) => feed.id)
  );
  const rankOf = (item: FeedItem): number =>
    rank.get(item.feedId) ?? feeds.length;

  return [...items].sort((left, right) => {
    const difference = rankOf(left) - rankOf(right);

    if (difference !== 0) return difference;

    const byId = compareIds(left.id, right.id);

    return newest.has(left.feedId) ? -byId : byId;
  });
};

/** One chapter per feed item, in book order, extracted one after another (KD-TEXT-6). */
const feedItemArticles = Effect.fnUntraced(function* (
  owner: OwnerId,
  items: ReadonlyArray<FeedItem>,
  feeds: ReadonlyArray<Feed>
) {
  const articles: Array<BookArticle> = [];

  for (const item of orderedByFeed(items, feeds)) {
    const feed = Option.fromUndefinedOr(
      feeds.find((row) => row.id === item.feedId)
    );
    const content = yield* textOf(owner, item, feed);

    articles.push({
      chapter: {
        title: item.title,
        source: Option.match(feed, {
          onNone: () => item.url.host,
          onSome: (row) => row.title,
        }),
        url: item.url,
        publishedAt: item.publishedAt,
        content,
      },
      ref: { kind: 'feed-item', id: item.id },
    });
  }

  return articles;
});

/**
 * Everything one send puts in the book, in book order, read at the moment of
 * the send (KD-SEND step 2, KD-BOOK-2); empty when nothing is unread.
 */
export const collect = Effect.fnUntraced(function* (owner: OwnerId) {
  const items = yield* FeedItemRepository;
  const pages = yield* SavedPageRepository;
  const unreadItems = yield* items.listAll(owner, unreadQuery);
  const unreadPages = yield* pages.list(owner, unreadQuery);

  if (unreadItems.length === 0 && unreadPages.length === 0) {
    return [];
  }

  const feeds = yield* FeedRepository;
  const followed = yield* feeds.list(owner);

  return [
    ...savedPageArticles(unreadPages),
    ...(yield* feedItemArticles(owner, unreadItems, followed)),
  ];
});
