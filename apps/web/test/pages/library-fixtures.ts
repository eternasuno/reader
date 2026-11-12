import { Option } from 'effect';
import { vi } from 'vitest';
import type {
  Article,
  ArticlePage,
  ArticleRef,
  Counts,
  Feed,
  Preview,
  Scope,
} from '../../src/lib/library';

export const article = (
  id: string,
  options: {
    readonly feedId?: string;
    readonly read?: boolean;
    readonly publishedAt?: string;
    readonly url?: string;
    readonly description?: string;
    readonly content?: string;
    readonly extractedContent?: string;
  } = {}
): Article => ({
  id,
  title: `Article ${id}`,
  publishedAt: options.publishedAt,
  read: options.read ?? false,
  feedId: Option.fromUndefinedOr(options.feedId),
  url: Option.fromUndefinedOr(options.url),
  description: Option.fromUndefinedOr(options.description),
  content: Option.fromUndefinedOr(options.content),
  extractedContent: Option.fromUndefinedOr(options.extractedContent),
});

export const page = (
  items: ReadonlyArray<Article>,
  cursor: string | null = null
): ArticlePage => ({ items, cursor });

export const feed = (
  id: string,
  url = `https://example.com/${id}.xml`
): Feed => ({
  id,
  ownerId: 'owner',
  url,
  title: `Feed ${id}`,
  updatedAt: Option.some('2026-01-01T00:00:00.000Z'),
});

export const counts = (
  later = 0,
  feeds: Record<string, number> = {}
): Counts => ({
  later,
  feeds,
  feedsTotal: Object.values(feeds).reduce((sum, value) => sum + value, 0),
});

export const preview: Preview = {
  url: 'https://example.com/feed.xml',
  title: 'Feed',
  description: Option.none(),
  titles: ['One'],
};

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
};

/** Stub transport whose defaults resolve to empty successful responses. */
export const createStubClient = () => ({
  list: vi.fn(async (_scope: Scope, _unreadOnly: boolean, _cursor?: string) =>
    page([])
  ),
  feeds: vi.fn(async () => [] as ReadonlyArray<Feed>),
  unreadCounts: vi.fn(async (): Promise<Counts> => counts()),
  article: vi.fn(async (_ref: ArticleRef) => null as Article | null),
  findSavedPageByUrl: vi.fn(async (_url: string) => null as Article | null),
  markRead: vi.fn(
    async (_ref: ArticleRef, _read: boolean): Promise<void> => undefined
  ),
  markLater: vi.fn(async (): Promise<void> => undefined),
  markAllFeeds: vi.fn(async (): Promise<void> => undefined),
  markFeeds: vi.fn(
    async (_feedIds: ReadonlyArray<string>): Promise<void> => undefined
  ),
  markArticles: vi.fn(
    async (_refs: ReadonlyArray<ArticleRef>): Promise<void> => undefined
  ),
  remove: vi.fn(async (_id: string): Promise<void> => undefined),
  save: vi.fn(async (_article: Article) => article('saved')),
  add: vi.fn(async (_url: string) => article('added')),
  extract: vi.fn(async (_article: Article) => article('extracted')),
  preview: vi.fn(async (_url: string) => preview),
  subscribe: vi.fn(async (_url: string, _title: string) => feed('f1')),
  unsubscribe: vi.fn(async (_id: string): Promise<void> => undefined),
});
