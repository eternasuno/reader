import { Effect, Option, Schema } from 'effect';
import type { FeedId } from '../entity/feed/feed';
import type { FeedItem, FeedItemId } from '../entity/feed/feed-item';
import type { ArticleContent } from '../entity/object-value/article';
import type { NormalizedUrl } from '../entity/object-value/normalized-url';
import type { OwnerId } from '../entity/object-value/owner-id';
import { SavedPage, SavedPageId } from '../entity/saved-page/saved-page';
import { FeedItemRepository } from '../port/feed-item-repository';
import { SavedPageRepository } from '../port/saved-page-repository';
import { ArticleEmptyContent, fetchAndExtract } from './extract-page';
import { FeedItemNotFound } from './feed-errors';
import { requireFeed } from './feed-items';
import { savedPageId } from './identity';
import type { ListCursor } from './list-cursor';
import { makePaging } from './pagination';
import type { ReadFilter } from './read-filter';
import { DuplicateSavedPage } from './saved-page-errors';

export const SavedPageList = Schema.Struct({
  items: Schema.Array(SavedPage),
  cursor: Schema.NullOr(Schema.String),
  boundary: Schema.NullOr(Schema.String),
});

export type SavedPageList = typeof SavedPageList.Type;

const savedPageFromFeedItem = (
  owner: OwnerId,
  item: FeedItem,
  content: ArticleContent
): SavedPage => ({
  id: savedPageId({
    ownerId: owner,
    url: item.url,
    title: item.title,
    description: item.description,
  }),
  ownerId: owner,
  url: item.url,
  title: item.title,
  description: item.description,
  content,
  publishedAt: item.publishedAt,
  read: false,
});

const insertSavedPage = (page: SavedPage, message: string) =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;
    const created = yield* pages.create([page]);
    if (created.length === 0) {
      return yield* new DuplicateSavedPage({ id: page.id, message });
    }

    return page;
  });

export const addSavedPage = (owner: OwnerId, url: NormalizedUrl) =>
  Effect.gen(function* () {
    const extracted = yield* fetchAndExtract(url);
    const page: SavedPage = {
      id: savedPageId({
        ownerId: owner,
        url: Option.some(url),
        title: extracted.title,
        description: extracted.description,
      }),
      ownerId: owner,
      url: Option.some(url),
      title: extracted.title,
      description: extracted.description,
      content: extracted.content,
      publishedAt: extracted.publishedAt,
      read: false,
    };

    return yield* insertSavedPage(page, 'Page already saved');
  });

const contentOf = (item: FeedItem) =>
  Effect.gen(function* () {
    if (Option.isSome(item.extractedContent)) {
      return item.extractedContent.value;
    }

    if (Option.isSome(item.content)) {
      return item.content.value;
    }

    if (Option.isSome(item.url)) {
      return (yield* fetchAndExtract(item.url.value)).content;
    }

    return yield* new ArticleEmptyContent({
      message: 'Article content is empty',
    });
  });

export const saveFeedItem = (owner: OwnerId, feedId: FeedId, id: FeedItemId) =>
  Effect.gen(function* () {
    yield* requireFeed(owner, feedId);
    const feedItems = yield* FeedItemRepository;
    const found = yield* feedItems.find(feedId, id);
    if (Option.isNone(found)) {
      return yield* new FeedItemNotFound({
        message: 'Feed item not found',
        id,
      });
    }

    const page = savedPageFromFeedItem(
      owner,
      found.value,
      yield* contentOf(found.value)
    );

    return yield* insertSavedPage(page, 'Page already saved');
  });

export const removeSavedPage = (owner: OwnerId, id: SavedPageId) =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;

    yield* pages.remove(owner, [id]);
  });

const savedPagePaging = (owner: OwnerId, filter: ReadFilter) =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;

    return makePaging({
      owner,
      scope: { kind: 'saved' },
      filter,
      toId: SavedPageId.make,
      fetchPage: (query) => pages.list(owner, query),
      fetchThrough: (query) => pages.listThrough(owner, query),
    });
  });

export const listSavedPages = (
  owner: OwnerId,
  filter: ReadFilter,
  cursor?: ListCursor
) =>
  Effect.gen(function* () {
    const paging = yield* savedPagePaging(owner, filter);

    return yield* paging.list(cursor);
  });

export const refreshSavedPages = (
  owner: OwnerId,
  filter: ReadFilter,
  through: ListCursor
) =>
  Effect.gen(function* () {
    const paging = yield* savedPagePaging(owner, filter);

    return yield* paging.refresh(through);
  });

export const findSavedPage = (owner: OwnerId, id: SavedPageId) =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;

    return yield* pages.find(owner, id);
  });

export const markSavedPages = (
  owner: OwnerId,
  ids: ReadonlyArray<SavedPageId>,
  read: boolean
) =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;

    yield* pages.update(owner, ids, { read });
  });

export const markAllSavedPagesRead = (owner: OwnerId) =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;

    yield* pages.updateAll(owner, { read: true });
  });
