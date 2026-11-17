import { vi } from 'vitest';
import type { Article, Scope } from '../../../src/web/library';

/**
 * The `library/` double of the reader tests (`vi.mock` returns this module): the
 * route's scope and open id, the loaded list of the current scope and the read
 * write. The list behaves like the real one — `replaceRow` replaces a loaded row
 * and `removeRow` drops it — so a test can watch what the reader does to it.
 */

let loaded: ReadonlyArray<Article> = [];

/** Sets the rows the loaded list of the scope holds. */
export const setRows = (next: ReadonlyArray<Article>): void => {
  loaded = next;
};

export const currentScope = vi.fn((): Scope => ({ kind: 'later' }));
export const openArticleId = vi.fn((): string | undefined => undefined);
export const openArticle = vi.fn();
export const closeArticle = vi.fn();
export const selectScope = vi.fn();
export const rows = vi.fn((): ReadonlyArray<Article> => loaded);
export const rowById = vi.fn((id: string): Article | undefined =>
  loaded.find((row) => row.item.id === id)
);
export const replaceRow = vi.fn((article: Article): void => {
  loaded = loaded.map((row) =>
    row.item.id === article.item.id ? article : row
  );
});
export const removeRow = vi.fn((id: string): void => {
  loaded = loaded.filter((row) => row.item.id !== id);
});
/** The read write: the reader takes its settled outcome (RD-READ-3). */
export const setArticleRead = vi.fn(
  async (_article: Article, _read: boolean): Promise<boolean> => true
);
export const sameScope = vi.fn();
export const scopePath = vi.fn((): string => '/later');

/** A request whose answer the test decides when it arrives. */
export const deferred = <A>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

/** Lets the requests an action started settle; the actions do not await them. */
export const settle = async (): Promise<void> => {
  await new Promise<void>((done) => {
    setTimeout(done, 0);
  });
};

let nextId = 0;

/** A fresh id per test, so the reader's module state treats it as a new article. */
export const freshId = (): string => {
  nextId += 1;

  return `article-${nextId}`;
};

/** The scope of a kind, with an id for the feed and folder scopes. */
const scopeOf = (kind: 'later' | 'all' | 'feed' | 'folder'): Scope => {
  if (kind === 'later') return { kind: 'later' };
  if (kind === 'all') return { kind: 'all' };

  return { kind, id: 'scope-1' };
};

/** Puts the route on one article. */
export const openId = (
  id: string | undefined,
  kind: 'later' | 'all' | 'feed' | 'folder' = 'later'
): void => {
  currentScope.mockReturnValue(scopeOf(kind));
  openArticleId.mockReturnValue(id);
};
