import { useLocation, useNavigate, useParams } from '@solidjs/router';
import { createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import type { Article, Feed, Scope } from '../../lib/library';
import {
  type LibraryModel,
  type PreviewResult,
  sameScope,
  useLibraryModel,
} from '../../pages/library-model';
import { Button } from '../atoms/button';
import { ReaderIcon } from '../atoms/reader-icon';
import { LibraryAccountMenu } from '../molecules/library-account-menu';
import { LibraryToastView } from '../molecules/library-toast';
import { LibraryAddDialog } from './library-add-dialog';
import { LibraryList } from './library-list';
import { LibraryReader } from './library-reader';
import { LibrarySidebar } from './library-sidebar';

type LibraryParams = {
  readonly kind?: string | undefined;
  readonly key?: string | undefined;
};

const articleKind = (article: Article): 'link' | 'feed' =>
  article.feedId === undefined ? 'link' : 'feed';

const articlePath = (article: Article): string =>
  `/read/${articleKind(article)}/${encodeURIComponent(article.id)}`;

const listPathOf = (scope: Scope): string =>
  scope.kind === 'later' ? '/' : '/rss';

const scopeLabel = (scope: Scope, feeds: readonly Feed[]): string => {
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

const unsubscribeFeed = (model: LibraryModel, feed: Feed) => {
  if (!window.confirm('取消订阅并删除该源的文章？已保存的稍后阅读不会删除。'))
    return;

  void model.unsubscribe(feed.id);
};

const MobileBar = (props: {
  readonly navOpen: boolean;
  readonly title: string;
  readonly onToggle: () => void;
}) => (
  <div class="hidden items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2 max-sm:flex">
    <Button
      type="button"
      class="grid size-11 cursor-pointer place-items-center"
      aria-label="切换导航"
      aria-expanded={props.navOpen}
      onClick={props.onToggle}
    >
      <ReaderIcon name={props.navOpen ? 'close' : 'menu'} />
    </Button>
    <span>
      留白 <span class="text-base-content/40">/ {props.title}</span>
    </span>
    <LibraryAccountMenu />
  </div>
);

const SidebarColumn = (props: {
  readonly model: LibraryModel;
  readonly route: RouteState;
  readonly onNavigate: () => void;
}) => {
  const state = () => props.model.state();

  return (
    <aside class="min-h-0 min-w-0 border-r border-base-300 bg-base-100 max-sm:col-start-1 max-sm:row-start-2 max-sm:hidden max-sm:group-data-[nav=true]/workspace:flex">
      <LibrarySidebar
        scope={state().scope}
        counts={state().counts}
        feeds={state().feeds}
        pending={state().pending}
        onPickScope={(scope) => {
          props.onNavigate();
          pickScope(props.model, props.route, scope);
        }}
        onUnsubscribe={(feed) => unsubscribeFeed(props.model, feed)}
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

export const LibraryWorkspace = () => {
  const model = useLibraryModel();
  const route = useLibraryRoute(model);
  const view = useLibraryView(model, route);
  const [navOpen, setNavOpen] = createSignal(false);
  const [addOpen, setAddOpen] = createSignal(false);

  return (
    <>
      <div
        class="group/workspace grid h-dvh grid-cols-[16rem_24rem_minmax(0,1fr)] overflow-hidden bg-[#121212] font-sans text-sm text-base-content max-xl:grid-cols-[13rem_20rem_minmax(0,1fr)] max-lg:grid-cols-[13rem_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[3.25rem_minmax(0,1fr)]"
        data-reading={route.key() !== undefined}
        data-nav={navOpen()}
      >
        <MobileBar
          navOpen={navOpen()}
          title={view.title()}
          onToggle={() => setNavOpen(!navOpen())}
        />
        <SidebarColumn
          model={model}
          route={route}
          onNavigate={() => setNavOpen(false)}
        />
        <ListColumn
          model={model}
          route={route}
          title={view.title()}
          onAdd={() => setAddOpen(true)}
        />
        <ReaderColumn
          model={model}
          route={route}
          article={view.article()}
          previous={view.previous()}
          next={view.next()}
        />
      </div>
      <LibraryAddDialog
        open={addOpen()}
        onClose={() => setAddOpen(false)}
        onAdd={(url) => addArticle(model, route, url)}
        onPreview={(url) => previewFeed(model, route, url)}
        onSubscribe={(url) => subscribeFeed(model, route, url)}
      />
      <LibraryToastView
        toast={model.state().toast}
        onDismiss={model.dismissToast}
      />
    </>
  );
};
