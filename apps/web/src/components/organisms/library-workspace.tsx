import { useLocation, useNavigate, useParams } from '@solidjs/router';
import { Option } from 'effect';
import { createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import type { Article, Feed, Scope } from '../../lib/library';
import {
  confirmUnsubscribe,
  createFeedMenu,
} from '../../pages/library-feed-menu';
import {
  type LibraryModel,
  type PreviewResult,
  sameScope,
  useLibraryModel,
} from '../../pages/library-model';
import { LibraryMobileBar } from '../molecules/library-mobile-bar';
import { LibraryToastView } from '../molecules/library-toast';
import { LibraryAddDialog } from './library-add-dialog';
import { LibraryList } from './library-list';
import { LibraryReader } from './library-reader';
import { LibrarySidebar } from './library-sidebar';

type LibraryParams = {
  readonly kind?: string | undefined;
  readonly key?: string | undefined;
};

const articlePath = (article: Article): string =>
  `/read/${Option.isNone(article.feedId) ? 'link' : 'feed'}/${encodeURIComponent(article.id)}`;

const listPathOf = (scope: Scope): string =>
  scope.kind === 'later' ? '/' : '/rss';

const scopeLabel = (scope: Scope, feeds: ReadonlyArray<Feed>): string => {
  if (scope.kind === 'later') return '稍后阅读';
  if (scope.feedId === undefined) return '全部订阅';

  return feeds.find((feed) => feed.id === scope.feedId)?.title ?? '订阅';
};

const useLibraryRoute = (model: LibraryModel) => {
  const location = useLocation();
  const params = useParams<LibraryParams>();
  const navigate = useNavigate();
  let opened: string | undefined;

  const openKey = (key: string, kind: string | undefined) => {
    const scope: Scope =
      kind === 'feed' ? { kind: 'feeds' } : { kind: 'later' };
    if (!sameScope(model.state().scope, scope)) void model.setScope(scope);
    void model.openArticle(key);
  };

  const open = (article: Article) => {
    opened = article.id;
    void model.openArticle(article.id);
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
    const path = location.pathname;
    if (path === '/rss') void model.setScope({ kind: 'feeds' });
    else if (path === '/') void model.setScope({ kind: 'later' });
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
    openKey(key, params.kind);
  });

  return { location, key: () => params.key, open, back, navigate };
};

type RouteState = ReturnType<typeof useLibraryRoute>;

const pickScope = (model: LibraryModel, route: RouteState, scope: Scope) => {
  void model.setScope(scope);
  const path = listPathOf(scope);
  if (route.location.pathname !== path) route.navigate(path);
};

const addArticle = async (
  model: LibraryModel,
  route: RouteState,
  url: string
): Promise<boolean> => {
  if (!(await model.add(url))) return false;
  const added = model.state().selected;
  if (added === undefined) route.back();
  else route.open(added);

  return true;
};

const subscribeFeed = async (
  model: LibraryModel,
  route: RouteState,
  url: string
): Promise<boolean> => {
  if (!(await model.subscribe(url))) return false;
  route.back();

  return true;
};

const previewFeed = async (
  model: LibraryModel,
  route: RouteState,
  url: string
): Promise<PreviewResult> => {
  const result = await model.preview(url);
  if (result.kind === 'existing') route.back();

  return result;
};

const removeArticle = async (
  model: LibraryModel,
  route: RouteState,
  article: Article
) => {
  const selected = model.state().selected?.id === article.id;
  if (!(await model.remove(article))) return;
  if (selected) route.back();
};

const saveArticle = async (
  model: LibraryModel,
  route: RouteState,
  article: Article
) => {
  await model.save(article);
  const selected = model.state().selected;
  if (selected !== undefined && selected.id !== article.id)
    route.open(selected);
};

const SidebarColumn = (props: {
  readonly model: LibraryModel;
  readonly route: RouteState;
  readonly onNavigate: () => void;
  readonly onAdd: (mode: 'article' | 'feed') => void;
}) => {
  const menu = createFeedMenu(props.model, (scope) => {
    props.onNavigate();
    props.route.navigate(listPathOf(scope));
  });

  return (
    <aside class="min-h-0 min-w-0 border-r border-base-300 bg-base-100 max-sm:col-start-1 max-sm:row-start-2 max-sm:hidden max-sm:group-data-[nav=true]/workspace:flex">
      <LibrarySidebar
        scope={props.model.state().scope}
        counts={props.model.state().counts}
        feeds={props.model.state().feeds}
        pending={props.model.state().pending}
        filter={props.model.state().filter}
        onAdd={props.onAdd}
        onFilterScope={(scope, checked) => void menu.filter(scope, checked)}
        onMarkScope={(scope) => void menu.markAll(scope)}
        onUnsubscribe={(feed) => confirmUnsubscribe(props.model, feed)}
        onPickScope={(scope) => {
          props.onNavigate();
          pickScope(props.model, props.route, scope);
        }}
      />
    </aside>
  );
};

const ListColumn = (props: {
  readonly model: LibraryModel;
  readonly route: RouteState;
  readonly title: string;
  readonly onAdd: () => void;
}) => (
  <section
    class="min-h-0 min-w-0 overflow-hidden border-r border-base-300 bg-base-100 max-sm:col-start-1 max-sm:row-start-2 max-sm:group-data-[nav=true]/workspace:hidden max-lg:group-data-[reading=true]/workspace:hidden"
    aria-label="文章列表"
  >
    <LibraryList
      model={props.model}
      title={props.title}
      onOpen={props.route.open}
      onAdd={props.onAdd}
      onUnsubscribe={(feed) => confirmUnsubscribe(props.model, feed)}
    />
  </section>
);

const ReaderColumn = (props: {
  readonly model: LibraryModel;
  readonly route: RouteState;
  readonly article: Article | undefined;
  readonly previous: Article | undefined;
  readonly next: Article | undefined;
}) => (
  <section
    class="min-h-0 min-w-0 overflow-hidden max-sm:col-start-1 max-sm:row-start-2 max-sm:group-data-[nav=true]/workspace:hidden max-lg:hidden max-lg:group-data-[reading=true]/workspace:block"
    aria-label="正文"
  >
    <LibraryReader
      article={props.article}
      pending={
        props.article !== undefined &&
        props.model.state().pending.has(props.article.id)
      }
      previous={props.previous}
      next={props.next}
      onBack={props.route.back}
      onOpen={props.route.open}
      onToggleRead={(article) => void props.model.toggleRead(article)}
      onSave={(article) => void saveArticle(props.model, props.route, article)}
      onRemove={(article) =>
        void removeArticle(props.model, props.route, article)
      }
      onExtract={props.model.extract}
    />
  </section>
);

const useLibraryView = (model: LibraryModel, route: RouteState) => {
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
    title: () => scopeLabel(model.state().scope, model.state().feeds),
  };
};

const AddDialog = (props: {
  readonly model: LibraryModel;
  readonly route: RouteState;
  readonly mode: 'article' | 'feed' | undefined;
  readonly onClose: () => void;
}) => (
  <LibraryAddDialog
    open={props.mode !== undefined}
    mode={props.mode ?? 'article'}
    onClose={props.onClose}
    onAdd={(url) => addArticle(props.model, props.route, url)}
    onPreview={(url) => previewFeed(props.model, props.route, url)}
    onSubscribe={(url) => subscribeFeed(props.model, props.route, url)}
  />
);

export const LibraryWorkspace = () => {
  const model = useLibraryModel();
  const route = useLibraryRoute(model);
  const view = useLibraryView(model, route);
  const [navOpen, setNavOpen] = createSignal(false);
  const [addMode, setAddMode] = createSignal<'article' | 'feed'>();

  return (
    <>
      <div
        class="group/workspace grid h-dvh grid-cols-[16rem_24rem_minmax(0,1fr)] overflow-hidden bg-[#121212] font-sans text-sm text-base-content max-xl:grid-cols-[13rem_20rem_minmax(0,1fr)] max-lg:grid-cols-[13rem_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[3.25rem_minmax(0,1fr)]"
        data-reading={route.key() !== undefined}
        data-nav={navOpen()}
      >
        <LibraryMobileBar
          navOpen={navOpen()}
          title={view.title()}
          onToggle={() => setNavOpen(!navOpen())}
        />
        <SidebarColumn
          model={model}
          route={route}
          onNavigate={() => setNavOpen(false)}
          onAdd={setAddMode}
        />
        <ListColumn
          model={model}
          route={route}
          title={view.title()}
          onAdd={() => setAddMode('article')}
        />
        <ReaderColumn
          model={model}
          route={route}
          article={view.article()}
          previous={view.previous()}
          next={view.next()}
        />
      </div>
      <AddDialog
        model={model}
        route={route}
        mode={addMode()}
        onClose={() => setAddMode(undefined)}
      />
      <LibraryToastView
        toast={model.state().toast}
        onDismiss={model.dismissToast}
      />
    </>
  );
};
