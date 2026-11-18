import { ApiFailure, type ApiFailureTag } from '../../../src/web/api/failure';
import type {
  Article,
  FeedItem,
  SavedPage,
} from '../../../src/web/library/scope';

/** Fixtures of the library's stores in the plain wire form `api/` returns. */

export type RowInput = {
  readonly id: string;
  readonly read?: boolean | undefined;
  readonly feedId?: string | undefined;
  readonly title?: string | undefined;
  readonly publishedAt?: string | undefined;
};

export const savedPage = (input: RowInput): SavedPage => ({
  id: input.id,
  ownerId: 'owner',
  url: `https://example.com/${input.id}`,
  title: input.title ?? input.id,
  content: '<p>body</p>',
  ...(input.publishedAt === undefined
    ? {}
    : { publishedAt: input.publishedAt }),
  read: input.read ?? false,
});

export const feedItem = (input: RowInput): FeedItem => ({
  id: input.id,
  ownerId: 'owner',
  feedId: input.feedId ?? 'feed-1',
  url: `https://example.com/${input.id}`,
  title: input.title ?? input.id,
  ...(input.publishedAt === undefined
    ? {}
    : { publishedAt: input.publishedAt }),
  read: input.read ?? false,
});

export const savedPageRow = (input: RowInput): Article => ({
  kind: 'saved-page',
  item: savedPage(input),
});

export const feedItemRow = (input: RowInput): Article => ({
  kind: 'feed-item',
  item: feedItem(input),
});

/** A failure as an `api/` function rejects with it: the tag names its wording. */
export const failure = (tag: ApiFailureTag): ApiFailure => new ApiFailure(tag);

export type Deferred<A> = {
  readonly promise: Promise<A>;
  readonly resolve: (value: A) => void;
  readonly reject: (reason: unknown) => void;
};

/** A promise a test settles when it wants that answer to arrive. */
export const deferred = <A>(): Deferred<A> => {
  let resolve!: (value: A) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<A>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
};

export const idOf = (article: Article): string => article.item.id;
