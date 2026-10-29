import type { FeedArticle } from '@reader/api';
import type { useLocation } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createSignal,
  type Setter,
  untrack,
} from 'solid-js';
import type { ReadingLink } from '../lib/links';

export type Scope = 'later' | 'rss';
export type Selection = {
  readonly kind: 'link' | 'feed';
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly read: boolean;
  readonly feedKey?: string | undefined;
};
export type SelectionState = Selection | undefined;
export type Selectable = Pick<
  Selection,
  'key' | 'title' | 'url' | 'read' | 'feedKey'
>;

export const routeSelection = (
  path: string,
  kind: string | undefined,
  key: string | undefined
): SelectionState => {
  if (!path.startsWith('/read/') || !key) return undefined;
  if (kind !== 'link' && kind !== 'feed') return undefined;
  return { kind, key, title: '', url: '', read: false };
};

type NavigationSelection = {
  readonly kind: 'link' | 'feed';
  readonly key: string;
};

export const adjacentItems = <T extends { readonly key: string }>(
  items: readonly T[],
  key: string | undefined
): { previous: T | undefined; next: T | undefined } => {
  const index = items.findIndex((item) => item.key === key);

  return {
    previous: index > 0 ? items[index - 1] : undefined,
    next: index >= 0 ? items[index + 1] : undefined,
  };
};

export const useReaderNavigation = (
  selection: Accessor<NavigationSelection | undefined>,
  selectLink: (item: ReadingLink) => void,
  selectFeed: (item: FeedArticle) => void
) => {
  const [links, setLinks] = createSignal<readonly ReadingLink[]>([]);
  const [feeds, setFeeds] = createSignal<readonly FeedArticle[]>([]);
  const handler = (
    direction: 'previous' | 'next'
  ): (() => void) | undefined => {
    const selected = selection();
    if (!selected) return undefined;

    if (selected.kind === 'link') {
      const item = adjacentItems(links(), selected.key)[direction];

      return item ? () => selectLink(item) : undefined;
    }

    const item = adjacentItems(feeds(), selected.key)[direction];

    return item ? () => selectFeed(item) : undefined;
  };

  return {
    onLinkItems: (items: readonly ReadingLink[]) =>
      untrack(() => setLinks(items)),
    onFeedItems: (items: readonly FeedArticle[]) =>
      untrack(() => setFeeds(items)),
    previous: () => handler('previous'),
    next: () => handler('next'),
  };
};

export const useRouteSync = (
  setScope: (scope: Scope) => void,
  setSelection: Setter<SelectionState>,
  location: ReturnType<typeof useLocation>,
  params: { readonly kind?: string; readonly key?: string }
) => {
  createEffect(() => {
    const article = routeSelection(location.pathname, params.kind, params.key);
    if (article) {
      setScope(article.kind === 'feed' ? 'rss' : 'later');
      setSelection((current) =>
        current?.kind === article.kind && current.key === article.key
          ? current
          : article
      );
    } else if (location.pathname !== '/settings') {
      setSelection(undefined);
      setScope(location.pathname.startsWith('/rss') ? 'rss' : 'later');
    }
  });

  return location;
};
