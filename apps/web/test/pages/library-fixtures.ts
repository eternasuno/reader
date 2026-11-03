import { Option } from 'effect';
import { vi } from 'vitest';
import type {
  Article,
  ArticlePage,
  Counts,
  Feed,
  Filter,
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
  ownerId: 'owner',
  title: `Article ${id}`,
  publishedAt: options.publishedAt ?? '2026-01-01T00:00:00.000Z',
  read: options.read ?? false,
  feedId: Option.fromUndefinedOr(options.feedId),
  url: Option.fromUndefinedOr(options.url),
  description: Option.fromUndefinedOr(options.description),
  content: Option.fromUndefinedOr(options.content),
  extractedContent: Option.fromUndefinedOr(options.extractedContent),
});

/** Article newer than the shared default so it sorts ahead of loaded rows. */
export const newerArticle = (
  id: string,
  options: { readonly feedId?: string; readonly read?: boolean } = {}
): Article =>
  article(id, { ...options, publishedAt: '2026-01-02T00:00:00.000Z' });

export const page = (
  items: readonly Article[],
  cursor: string | null = null,
  boundary: string | null = null
): ArticlePage => ({ items, cursor, boundary });

export const feed = (id: string): Feed => ({
  id,
  ownerId: 'owner',
  url: `https://example.com/${id}.xml`,
  title: `Feed ${id}`,
  updatedAt: '2026-01-01T00:00:00.000Z',
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
  list: vi.fn(async (_scope: Scope, _filter: Filter, _cursor?: string) =>
    page([])
  ),
  refresh: vi.fn(
    async (_scope: Scope, _filter: Filter, _through: string) =>
      [] as readonly Article[]
  ),
  feeds: vi.fn(async () => [] as readonly Feed[]),
  laterUnread: vi.fn(async () => 0),
  feedUnread: vi.fn(
    async (): Promise<{
      readonly total: number;
      readonly feeds: Readonly<Record<string, number>>;
    }> => ({ total: 0, feeds: {} })
  ),
  article: vi.fn(async (_id: string) => null as Article | null),
  markRead: vi.fn(
    async (_id: string, _read: boolean): Promise<void> => undefined
  ),
  markLater: vi.fn(async (): Promise<void> => undefined),
  markFeeds: vi.fn(
    async (_feedIds: readonly string[]): Promise<void> => undefined
  ),
  markArticles: vi.fn(
    async (_ids: readonly string[]): Promise<void> => undefined
  ),
  remove: vi.fn(async (_id: string): Promise<void> => undefined),
  save: vi.fn(async (_id: string) => article('saved')),
  add: vi.fn(async (_url: string) => article('added')),
  extract: vi.fn(async (_id: string) => article('extracted')),
  preview: vi.fn(async (_url: string) => preview),
  subscribe: vi.fn(async (_url: string) => feed('f1')),
  unsubscribe: vi.fn(async (_id: string): Promise<void> => undefined),
});
