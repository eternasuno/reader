import { useLocation, useNavigate, useParams } from '@solidjs/router';
import { onCleanup } from 'solid-js';
import {
  articleIdOf,
  hasUnread,
  type LibraryParams,
  scopeFromPath,
} from './route-path';
import { type Scope, sameScope, scopePath } from './scope';

/**
 * The URL is the source of truth for the scope, the open article and the unread
 * filter (LIB-URL-1). The router hooks only work inside the shell, so
 * `useLibraryRoute` binds them once and the actions below read and change the
 * route through that binding; what a path says is in `route-path.ts`.
 */

type Binding = {
  readonly scope: () => Scope;
  readonly articleId: () => string | undefined;
  readonly unread: () => boolean;
  readonly navigate: (path: string) => void;
};

let binding: Binding | undefined;

/** The selected scope (LIB-SCOPE-1), read from the route. */
export const currentScope = (): Scope => binding?.scope() ?? { kind: 'later' };

/** The id of the article open in the reader, if any. */
export const openArticleId = (): string | undefined => binding?.articleId();

/** Whether the one shared unread filter is on (LIB-FILTER-1). */
export const unreadFilter = (): boolean => binding?.unread() ?? false;

const go = (path: string): void => {
  binding?.navigate(path);
};

/** A scope's path, naming the open article only when there is one. */
const pathWith = (
  scope: Scope,
  unread: boolean,
  articleId: string | undefined
): string =>
  articleId === undefined
    ? scopePath(scope, { unread })
    : scopePath(scope, { unread, articleId });

/** Turns the shared filter on or off; the same value changes nothing (LIB-FILTER-2). */
export const setUnreadFilter = (on: boolean): void => {
  if (unreadFilter() === on) return;

  go(pathWith(currentScope(), on, openArticleId()));
};

/** Opens an article in the reader at its own URL (LIB-URL-1). */
export const openArticle = (id: string): void => {
  go(pathWith(currentScope(), unreadFilter(), id));
};

/** Goes back to the scope's list, keeping the filter (LIB-ROW-3, LIB-URL-1). */
export const closeArticle = (): void => {
  go(scopePath(currentScope(), { unread: unreadFilter() }));
};

/**
 * Selects a scope (LIB-SCOPE-3): a different scope navigates to its list, and
 * selecting the selected scope only closes an open article and otherwise
 * leaves the URL and the loaded list alone.
 */
export const selectScope = (scope: Scope): void => {
  const same = sameScope(currentScope(), scope);

  if (same && openArticleId() === undefined) return;

  go(scopePath(scope, { unread: unreadFilter() }));
};

/** Binds the router to this module; called once by the shell. */
export const useLibraryRoute = (): void => {
  const location = useLocation();
  const params = useParams<LibraryParams>();
  const navigate = useNavigate();
  const route: Binding = {
    scope: () => scopeFromPath(location.pathname),
    articleId: () => articleIdOf(params),
    unread: () => hasUnread(location.search),
    navigate: (path) => navigate(path),
  };

  binding = route;
  onCleanup(() => {
    if (binding === route) binding = undefined;
  });
};
