import type { Article, FeedItem, SavedPage } from '../../../src/web/library';

/** Fixtures of the saved-page tests in the plain wire form `api/` returns. */

type SavedPageOptions = {
  readonly read?: boolean;
  readonly url?: string;
  readonly title?: string;
  readonly content?: string;
};

export const savedPageFixture = (
  id: string,
  options: SavedPageOptions = {}
): SavedPage => ({
  id,
  ownerId: 'owner-1',
  url: options.url ?? `https://example.com/${id}`,
  title: options.title ?? '怎样阅读',
  content: options.content ?? '<p>正文第一段</p>',
  read: options.read ?? false,
});

type FeedItemOptions = {
  readonly read?: boolean;
  readonly url?: string;
  readonly title?: string;
  readonly description?: string;
  readonly content?: string;
  readonly extractedContent?: string;
};

export const feedItemFixture = (
  id: string,
  options: FeedItemOptions = {}
): FeedItem => ({
  id,
  ownerId: 'owner-1',
  feedId: 'feed-1',
  url: options.url ?? `https://example.com/${id}`,
  title: options.title ?? '示例文章',
  ...(options.description === undefined
    ? {}
    : { description: options.description }),
  ...(options.content === undefined ? {} : { content: options.content }),
  ...(options.extractedContent === undefined
    ? {}
    : { extractedContent: options.extractedContent }),
  read: options.read ?? false,
});

export const savedPageArticle = (page: SavedPage): Article => ({
  kind: 'saved-page',
  item: page,
});

export const feedItemArticle = (item: FeedItem): Article => ({
  kind: 'feed-item',
  item,
});
