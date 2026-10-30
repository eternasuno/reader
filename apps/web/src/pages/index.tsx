import { RegistryProvider } from '@effect/atom-solid/RegistryContext';
import type { FeedArticle } from '@reader/api';
import { useLocation, useNavigate, useParams } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  type Setter,
  Show,
} from 'solid-js';
import { Button } from '../components/atoms/button';
import { ReaderIcon } from '../components/atoms/reader-icon';
import { Dialog } from '../components/molecules/dialog';
import { ArticleReader } from '../components/organisms/article-reader';
import { FeedReader } from '../components/organisms/feed-reader';
import { ReaderSettings } from '../components/organisms/reader-settings';
import { ReadingList } from '../components/organisms/reading-list';
import { WorkspaceAccountMenu } from '../components/organisms/workspace-account-menu';
import { WorkspaceNav } from '../components/organisms/workspace-nav';
import { authClient } from '../lib/auth';
import type { ReadingLink } from '../lib/links';
import {
  focusWhenReady,
  usePeriodicReaderRefresh,
  useTriggerFocus,
} from './reader-lifecycle';
import {
  type Scope,
  type Selectable,
  type Selection,
  type SelectionState,
  useReaderNavigation,
  useRouteSync,
} from './reader-navigation';
import { WorkspaceDataProvider } from './workspace-state';

const scopePath = (scope: Scope): string => (scope === 'rss' ? '/rss' : '/');

const toSelection = (kind: Selection['kind'], item: Selectable): Selection => ({
  kind,
  ...item,
});

const keyFor = (selection: SelectionState, kind: Selection['kind']) =>
  selection?.kind === kind ? selection.key : undefined;

const visibleListHeading = () =>
  Array.from(
    document.querySelectorAll('.workspace-list h2[tabindex="-1"]'),
    (heading) => heading as HTMLElement
  ).find((element) => element.getClientRects().length > 0);

const focusListHeading = () => focusWhenReady(visibleListHeading);

const useSelectionMemory = (
  selection: Accessor<SelectionState>,
  setSelection: Setter<SelectionState>
) => {
  const navigate = useNavigate();
  let lastTrigger: HTMLElement | undefined;
  const triggerFocus = useTriggerFocus(focusListHeading);
  const restoreTrigger = () => {
    triggerFocus.disconnect();
    focusWhenReady(() => {
      const trigger = lastTrigger;
      if (!trigger?.isConnected || trigger.getClientRects().length === 0)
        return visibleListHeading();

      triggerFocus.watch(trigger);

      return trigger;
    });
  };
  const selectKind = (kind: Selection['kind'], item: Selectable) => {
    triggerFocus.disconnect();
    const active = document.activeElement;
    if (
      active instanceof HTMLAnchorElement &&
      active.matches('.workspace-list a.entry-title')
    )
      lastTrigger = active;
    setSelection((current) =>
      current?.kind === kind && current.key === item.key
        ? current
        : toSelection(kind, item)
    );
    navigate(`/read/${kind}/${encodeURIComponent(item.key)}`);
  };
  const selectLink = (item: ReadingLink) => selectKind('link', item);
  const selectFeed = (item: FeedArticle) => selectKind('feed', item);

  return {
    selectLink,
    selectFeed,
    restoreTrigger,
    readerNavigation: useReaderNavigation(selection, selectLink, selectFeed),
  };
};

const useWorkspaceRoute = (
  setScope: (scope: Scope) => void,
  setSelection: Setter<SelectionState>
) => useRouteSync(setScope, setSelection, useLocation(), useParams());

const useWorkspace = () => {
  usePeriodicReaderRefresh();
  const navigate = useNavigate();
  const [scope, setScope] = createSignal<Scope>('later');
  const [feedKey, setFeedKey] = createSignal('');
  const [selection, setSelection] = createSignal<SelectionState>(undefined);
  const [manageOpen, setManageOpen] = createSignal(false);
  const [navOpen, setNavOpen] = createSignal(false);
  const [feedRevision, setFeedRevision] = createSignal(0);
  const location = useWorkspaceRoute(setScope, setSelection);
  const memory = useSelectionMemory(selection, setSelection);

  const go = (next: Scope, path: string) => {
    setNavOpen(false);
    setScope(next);
    setFeedKey('');
    setSelection(undefined);
    navigate(path);
    focusListHeading();
  };

  return {
    location,
    navigate,
    scope,
    feedKey,
    selection,
    manageOpen,
    navOpen,
    setNavOpen,
    feedRevision,
    setFeedKey,
    setScope,
    setSelection,
    setManageOpen,
    closeManage: () => {
      setManageOpen(false);
      setFeedRevision((revision) => revision + 1);
    },
    pickLater: () => go('later', '/'),
    pickRss: () => go('rss', '/rss'),
    ...memory,
    openSettings: () => {
      setNavOpen(false);
      navigate('/settings');
    },
  };
};

type WorkspaceModel = ReturnType<typeof useWorkspace>;

const clearSelection = (model: WorkspaceModel) => {
  model.setSelection(undefined);
  if (model.location.pathname.startsWith('/read/'))
    model.navigate(scopePath(model.scope()));
  model.restoreTrigger();
};

const closeSettings = (model: WorkspaceModel) => {
  if (model.location.pathname !== '/settings') return;
  const selection = model.selection();
  if (selection)
    model.navigate(
      `/read/${selection.kind}/${encodeURIComponent(selection.key)}`,
      { replace: true }
    );
  else model.navigate(scopePath(model.scope()), { replace: true });
};

const pickFeed = (model: WorkspaceModel, key: string) => {
  model.setNavOpen(false);
  model.setScope('rss');
  model.setFeedKey(key);
  model.setSelection(undefined);
  if (model.location.pathname !== '/rss') model.navigate('/rss');
  focusListHeading();
};

const WorkspaceList = (props: { readonly model: WorkspaceModel }) => (
  <section
    class="workspace-list min-h-0 min-w-0 overflow-hidden border-r border-base-300 bg-base-100 max-sm:col-start-1 max-sm:row-start-2 max-sm:group-data-[nav=true]/workspace:hidden max-lg:group-data-[reading=true]/workspace:hidden"
    aria-label="文章列表"
  >
    <div class="h-full min-h-0" hidden={props.model.scope() !== 'later'}>
      <ReadingList
        active={props.model.scope() === 'later'}
        selectedKey={keyFor(props.model.selection(), 'link')}
        onSelect={props.model.selectLink}
        onItems={props.model.readerNavigation.onLinkItems}
      />
    </div>
    <div class="h-full min-h-0" hidden={props.model.scope() !== 'rss'}>
      <FeedReader
        active={props.model.scope() === 'rss'}
        feedKey={props.model.feedKey()}
        selectedKey={keyFor(props.model.selection(), 'feed')}
        onSelect={props.model.selectFeed}
        onItems={props.model.readerNavigation.onFeedItems}
      />
    </div>
  </section>
);

const WorkspaceReader = (props: { readonly model: WorkspaceModel }) => (
  <section
    class="workspace-reader min-h-0 min-w-0 overflow-hidden max-sm:col-start-1 max-sm:row-start-2 max-sm:group-data-[nav=true]/workspace:hidden max-lg:hidden max-lg:group-data-[reading=true]/workspace:block"
    aria-label="正文"
  >
    <Show
      when={props.model.selection()}
      fallback={
        <div class="grid h-full place-items-center px-6 text-center">
          <div class="flex flex-col items-center gap-4">
            <ReaderIcon name="reading" class="size-10 text-base-content/25" />
            <p class="text-sm text-base-content/60">未选择文章</p>
            <p class="text-xs text-base-content/60">
              从左侧选择一篇文章，开始阅读
            </p>
          </div>
        </div>
      }
      keyed
    >
      {(selection) => (
        <ArticleReader
          selection={selection}
          onPrevious={props.model.readerNavigation.previous()}
          onNext={props.model.readerNavigation.next()}
          onBack={() => clearSelection(props.model)}
        />
      )}
    </Show>
  </section>
);

const Workspace = () => {
  const model = useWorkspace();

  return (
    <div
      class="group/workspace grid h-dvh grid-cols-[16rem_24rem_minmax(0,1fr)] overflow-hidden bg-[#121212] font-sans text-sm text-base-content max-xl:grid-cols-[12rem_20rem_minmax(0,1fr)] max-lg:grid-cols-[14rem_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[3.25rem_minmax(0,1fr)]"
      data-reading={model.selection() !== undefined}
      data-nav={model.navOpen()}
    >
      <div class="hidden items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2 max-sm:flex">
        <Button
          type="button"
          class="grid size-11 cursor-pointer place-items-center"
          aria-label="切换导航"
          aria-expanded={model.navOpen()}
          onClick={() => model.setNavOpen(!model.navOpen())}
        >
          <ReaderIcon name={model.navOpen() ? 'close' : 'menu'} />
        </Button>
        <span>
          留白{' '}
          <span class="text-base-content/40">
            / {model.scope() === 'rss' ? '全部文章' : '稍后阅读'}
          </span>
        </span>
        <WorkspaceAccountMenu
          onSettings={model.openSettings}
          onManage={() => model.setManageOpen(true)}
        />
      </div>
      <WorkspaceNav
        class="max-sm:col-start-1 max-sm:row-start-2 max-sm:hidden max-sm:group-data-[nav=true]/workspace:flex"
        scope={model.scope()}
        feedKey={model.feedKey()}
        feedRevision={model.feedRevision()}
        onPickLater={model.pickLater}
        onPickRss={model.pickRss}
        onManage={() => model.setManageOpen(true)}
        onPickFeed={(key) => pickFeed(model, key)}
        onSettings={model.openSettings}
      />
      <WorkspaceList model={model} />
      <WorkspaceReader model={model} />
      <Dialog
        open={model.location.pathname === '/settings'}
        label="设置"
        onClose={() => closeSettings(model)}
      >
        <ReaderSettings />
      </Dialog>
      <Dialog
        open={model.manageOpen()}
        label="添加订阅"
        onClose={() => model.closeManage()}
      >
        <FeedReader management />
      </Dialog>
    </div>
  );
};

export const ReaderPage = (_props: {
  readonly rss?: boolean | undefined;
  readonly settings?: boolean | undefined;
  readonly article?: boolean | undefined;
  readonly children?: JSX.Element | undefined;
}) => {
  const navigate = useNavigate();
  const session = authClient.useSession();
  createEffect(() => {
    const current = session();
    if (!current.isPending && !current.data && !current.error)
      navigate('/login', { replace: true });
  });

  return (
    <main>
      <Show when={!session().isPending} fallback={<p>正在确认登录状态…</p>}>
        <Show
          when={!session().error}
          fallback={<p role="alert">暂时无法确认登录状态，请刷新重试。</p>}
        >
          <Show when={session().data?.user.id} keyed>
            {(_userId) => (
              <RegistryProvider>
                <WorkspaceDataProvider>
                  <Workspace />
                </WorkspaceDataProvider>
              </RegistryProvider>
            )}
          </Show>
        </Show>
      </Show>
    </main>
  );
};

export default function Home() {
  return <ReaderPage />;
}
