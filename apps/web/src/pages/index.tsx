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
import { ReaderIcon } from '../components/atoms/reader-icon';
import { ArticleReader } from '../components/organisms/article-reader';
import { FeedReader } from '../components/organisms/feed-reader';
import { ReaderSettings } from '../components/organisms/reader-settings';
import { ReadingList } from '../components/organisms/reading-list';
import { WorkspaceNav } from '../components/organisms/workspace-nav';
import { authClient } from '../lib/auth';
import type { ReadingLink } from '../lib/links';
import { useDeferredReaderRefresh, useTriggerFocus } from './reader-lifecycle';
import {
  type Scope,
  type Selectable,
  type Selection,
  type SelectionState,
  useReaderNavigation,
  useRouteSync,
} from './reader-navigation';

const scopePath = (scope: Scope): string => (scope === 'rss' ? '/rss' : '/');

const toSelection = (kind: Selection['kind'], item: Selectable): Selection => ({
  kind,
  ...item,
});

const keyFor = (selection: SelectionState, kind: Selection['kind']) =>
  selection?.kind === kind ? selection.key : undefined;

const isNarrowViewport = () => window.matchMedia('(max-width: 1000px)').matches;

const hasOpenDialog = () => document.querySelector('dialog[open]') !== null;

const focusIfVisible = (element: HTMLElement | undefined) => {
  if (!element) return;
  if (!element.isConnected) return;
  if (element.getClientRects().length === 0) return;
  element.focus();
};

const focusWhenReady = (getTarget: () => HTMLElement | undefined) => {
  if (!isNarrowViewport() || hasOpenDialog()) return;
  queueMicrotask(() => {
    if (hasOpenDialog()) return;
    focusIfVisible(getTarget());
  });
};

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
  useDeferredReaderRefresh(selection);
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
  <section class="workspace-list" aria-label="文章列表">
    <div hidden={props.model.scope() !== 'later'}>
      <ReadingList
        selectedKey={keyFor(props.model.selection(), 'link')}
        onSelect={props.model.selectLink}
        onItems={props.model.readerNavigation.onLinkItems}
      />
    </div>
    <div hidden={props.model.scope() !== 'rss'}>
      <FeedReader
        feedKey={props.model.feedKey()}
        selectedKey={keyFor(props.model.selection(), 'feed')}
        onSelect={props.model.selectFeed}
        onItems={props.model.readerNavigation.onFeedItems}
      />
    </div>
  </section>
);

const WorkspaceReader = (props: { readonly model: WorkspaceModel }) => (
  <section class="workspace-reader" aria-label="正文">
    <Show
      when={props.model.selection()}
      fallback={
        <div class="reader-empty">
          <p>未选择文章</p>
        </div>
      }
      keyed
    >
      {(selection) => (
        <ArticleReader
          selection={selection}
          onSettings={props.model.openSettings}
          onPrevious={props.model.readerNavigation.previous()}
          onNext={props.model.readerNavigation.next()}
          onBack={() => clearSelection(props.model)}
        />
      )}
    </Show>
  </section>
);

const ShellDialog = (props: {
  readonly open: boolean;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: JSX.Element;
}) => {
  let ref!: HTMLDialogElement;
  createEffect(() => {
    if (!props.open && ref.open) ref.close();
    else if (props.open && !ref.open) ref.showModal();
  });
  return (
    <dialog
      ref={(element) => {
        ref = element;
      }}
      onClose={props.onClose}
      aria-label={props.label}
    >
      <form method="dialog">
        <button type="submit" class="btn btn-ghost btn-sm" aria-label="关闭">
          <ReaderIcon name="close" />
        </button>
      </form>
      {props.children}
    </dialog>
  );
};

const Workspace = () => {
  const model = useWorkspace();
  return (
    <div
      class="reader-workspace"
      classList={{
        'mobile-reading': model.selection() !== undefined,
        'nav-open': model.navOpen(),
      }}
    >
      <div class="workspace-mobile-bar">
        <button
          type="button"
          aria-label="切换导航"
          aria-expanded={model.navOpen()}
          onClick={() => model.setNavOpen(!model.navOpen())}
        >
          <ReaderIcon name={model.navOpen() ? 'close' : 'menu'} />
        </button>
        <span>
          留白{' '}
          <span class="text-base-content/40">
            / {model.scope() === 'rss' ? '全部文章' : '稍后阅读'}
          </span>
        </span>
        <button type="button" aria-label="设置" onClick={model.openSettings}>
          <ReaderIcon name="settings" />
        </button>
      </div>
      <WorkspaceNav
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
      <ShellDialog
        open={model.location.pathname === '/settings'}
        label="设置"
        onClose={() => closeSettings(model)}
      >
        <ReaderSettings />
      </ShellDialog>
      <ShellDialog
        open={model.manageOpen()}
        label="订阅管理"
        onClose={() => model.closeManage()}
      >
        <FeedReader management />
      </ShellDialog>
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
                <Workspace />
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
