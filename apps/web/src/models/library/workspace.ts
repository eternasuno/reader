import { useLocation, useNavigate, useParams } from '@solidjs/router';
import { Option } from 'effect';
import { createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import type { Article, Scope } from '../../api/library';
import type { LibraryModel } from './model';
import { articlePath } from './path';
import { type LibraryState, sameScope } from './state';

type LibraryParams = {
  readonly feedId?: string | undefined;
  readonly key?: string | undefined;
};

export const listPathOf = (scope: Scope): string =>
  scope.kind === 'later' ? '/' : '/rss';

const enteredScope = (path: string): Scope =>
  path === '/rss' || path.startsWith('/read/feed/')
    ? { kind: 'feeds' }
    : { kind: 'later' };

const scopeLabel = (state: LibraryState): string => {
  const { scope } = state;
  if (scope.kind === 'later') return '稍后阅读';
  if (scope.kind === 'folder') {
    const name = state.folders.find((item) => item.id === scope.folderId)?.name;

    return name ?? '目录';
  }

  if (scope.feedId === undefined) return '全部订阅';

  return state.feeds.find((feed) => feed.id === scope.feedId)?.title ?? '订阅';
};

export const useLibraryRoute = (model: LibraryModel) => {
  const location = useLocation();
  const params = useParams<LibraryParams>();
  const navigate = useNavigate();
  let opened: string | undefined;

  const openKey = (key: string, feedId: string | undefined) => {
    const scope: Scope =
      feedId === undefined ? { kind: 'later' } : { kind: 'feeds' };
    if (!sameScope(model.state().scope, scope)) void model.setScope(scope);

    void model.openArticle(key, feedId);
  };

  const open = (article: Article) => {
    opened = article.id;
    void model.openArticle(article.id, Option.getOrUndefined(article.feedId));
    const path = articlePath(article);
    if (location.pathname !== path) navigate(path);
  };

  const back = () => {
    model.clearSelection();
    opened = undefined;
    const path = listPathOf(model.state().scope);
    if (location.pathname !== path) navigate(path);
  };

  onMount(() => {
    void model.enter(enteredScope(location.pathname));
  });

  createEffect(() => {
    const path = location.pathname;
    if (!path.startsWith('/read/')) {
      opened = undefined;

      return;
    }

    const key = params.key;
    if (key === undefined || key === '' || key === opened) return;

    opened = key;
    openKey(key, params.feedId);
  });

  return { location, key: () => params.key, open, back, navigate };
};

export type RouteState = ReturnType<typeof useLibraryRoute>;

export const pickScope = (
  model: LibraryModel,
  route: RouteState,
  scope: Scope
) => {
  void model.setScope(scope);
  const path = listPathOf(scope);
  if (route.location.pathname !== path) route.navigate(path);
};

export const removeArticle = async (
  model: LibraryModel,
  route: RouteState,
  article: Article
) => {
  const selected = model.state().selected?.id === article.id;
  if (!(await model.remove(article))) return;

  if (selected) route.back();
};

export const saveArticle = async (
  model: LibraryModel,
  route: RouteState,
  article: Article
) => {
  await model.save(article);
  const selected = model.state().selected;
  if (selected !== undefined && selected.id !== article.id)
    route.open(selected);
};

export const useLibraryView = (model: LibraryModel, route: RouteState) => {
  const [snapshot, setSnapshot] = createSignal<Article>();
  createEffect(() => {
    const selected = model.state().selected;
    if (selected !== undefined) setSnapshot(selected);
  });
  createEffect(
    on(
      () => route.key(),
      (key) => {
        if (key === undefined || key === '') setSnapshot(undefined);
      }
    )
  );
  const article = createMemo(() => {
    const key = route.key();
    if (key === undefined || key === '') return undefined;

    const selected = model.state().selected;
    if (selected !== undefined && selected.id === key) return selected;

    const remembered = snapshot();

    return remembered?.id === key ? remembered : undefined;
  });
  const neighbours = createMemo(() => {
    const current = article();
    const items = model.state().items;
    const index =
      current === undefined
        ? -1
        : items.findIndex((item) => item.id === current.id);

    return {
      previous: index > 0 ? items[index - 1] : undefined,
      next: index >= 0 ? items[index + 1] : undefined,
    };
  });

  return {
    article,
    previous: () => neighbours().previous,
    next: () => neighbours().next,
    title: () => scopeLabel(model.state()),
  };
};
