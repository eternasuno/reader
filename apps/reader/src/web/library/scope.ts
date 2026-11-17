import type { FeedItem } from '../api/feed-item';
import type { SavedPage } from '../api/saved-page';

export type { FeedItem } from '../api/feed-item';
export type { SavedPage } from '../api/saved-page';

/** What the article list shows (LIB-SCOPE-1); equal when kind and id match (LIB-SCOPE-3). */
export type Scope =
  | { readonly kind: 'later' }
  | { readonly kind: 'all' }
  | { readonly kind: 'feed'; readonly id: string }
  | { readonly kind: 'folder'; readonly id: string };

/** One row of the article list or the open article: a saved page or a feed item. */
export type Article =
  | { readonly kind: 'saved-page'; readonly item: SavedPage }
  | { readonly kind: 'feed-item'; readonly item: FeedItem };

const scopeKey = (scope: Scope): string =>
  scope.kind === 'later' || scope.kind === 'all'
    ? scope.kind
    : `${scope.kind}:${scope.id}`;

export const sameScope = (a: Scope, b: Scope): boolean =>
  scopeKey(a) === scopeKey(b);

/**
 * The route of a scope, with an open article when `articleId` is given; keeps
 * the shared unread filter as the presence-only `?unread` (reader-spec Routes).
 */
export const scopePath = (
  scope: Scope,
  options: { readonly unread: boolean; readonly articleId?: string }
): string => {
  const base =
    scope.kind === 'later' || scope.kind === 'all'
      ? `/${scope.kind}`
      : `/${scope.kind}/${scope.id}`;
  const path =
    options.articleId === undefined ? base : `${base}/${options.articleId}`;
  return options.unread ? `${path}?unread` : path;
};
