import { useNavigate } from '@solidjs/router';
import { createEffect, createSignal, Show } from 'solid-js';
import { authClient } from '../api/auth';
import {
  LibraryDialogs,
  useLibraryDialogs,
} from '../components/organisms/library/dialogs';
import { LibraryList } from '../components/organisms/library/list';
import { LibraryMobileBar } from '../components/organisms/library/mobile-bar';
import { LibraryReader } from '../components/organisms/library/reader';
import { LibrarySidebar } from '../components/organisms/library/sidebar';
import { LibraryToastView } from '../components/organisms/library/toast';
import { LibraryLayout } from '../components/templates/library-layout';
import {
  confirmRemoveFolder,
  confirmUnsubscribe,
  createFeedMenu,
} from '../models/library/feed-menu';
import { type LibraryModel, useLibraryModel } from '../models/library/model';
import {
  listPathOf,
  pickScope,
  type RouteState,
  removeArticle,
  saveArticle,
  useLibraryRoute,
  useLibraryView,
} from '../models/library/workspace';

type Dialogs = ReturnType<typeof useLibraryDialogs>;

type LibraryView = ReturnType<typeof useLibraryView>;

const pendingOf = (view: LibraryView, model: LibraryModel): boolean => {
  const article = view.article();

  return article !== undefined && model.state().pending.has(article.id);
};

const SidebarColumn = (props: {
  readonly model: LibraryModel;
  readonly route: RouteState;
  readonly dialogs: Dialogs;
  readonly onNavigate: () => void;
}) => {
  const menu = createFeedMenu(props.model, (scope) => {
    props.onNavigate();
    props.route.navigate(listPathOf(scope));
  });

  return (
    <LibrarySidebar
      scope={props.model.state().scope}
      counts={props.model.state().counts}
      feeds={props.model.state().feeds}
      folders={props.model.state().folders}
      pending={props.model.state().pending}
      unreadOnly={props.model.state().unreadOnly}
      onAdd={props.dialogs.openAdd}
      onFilterScope={(scope, checked) => void menu.filter(scope, checked)}
      onMarkScope={(scope) => void menu.markAll(scope)}
      onUnsubscribe={(feed) => confirmUnsubscribe(props.model, feed)}
      onCreateFolder={props.dialogs.createFolder}
      onRenameFolder={props.dialogs.renameFolder}
      onRemoveFolder={(folder) => confirmRemoveFolder(props.model, folder)}
      onMoveFeed={props.dialogs.moveFeed}
      onPickScope={(scope) => {
        props.onNavigate();
        pickScope(props.model, props.route, scope);
      }}
    />
  );
};

const ListColumn = (props: {
  readonly model: LibraryModel;
  readonly route: RouteState;
  readonly view: LibraryView;
  readonly dialogs: Dialogs;
}) => (
  <LibraryList
    model={props.model}
    title={props.view.title()}
    onOpen={props.route.open}
    onAdd={() => props.dialogs.openAdd('article')}
    onUnsubscribe={(feed) => confirmUnsubscribe(props.model, feed)}
  />
);

const ReaderColumn = (props: {
  readonly model: LibraryModel;
  readonly route: RouteState;
  readonly view: LibraryView;
}) => (
  <LibraryReader
    article={props.view.article()}
    pending={pendingOf(props.view, props.model)}
    previous={props.view.previous()}
    next={props.view.next()}
    onBack={props.route.back}
    onOpen={props.route.open}
    onToggleRead={(article) => void props.model.toggleRead(article)}
    onSave={(article) => void saveArticle(props.model, props.route, article)}
    onRemove={(article) =>
      void removeArticle(props.model, props.route, article)
    }
    onExtract={props.model.extract}
  />
);

const LibraryWorkspace = () => {
  const model = useLibraryModel();
  const route = useLibraryRoute(model);
  const view = useLibraryView(model, route);
  const dialogs = useLibraryDialogs();
  const [navOpen, setNavOpen] = createSignal(false);
  const closeNav = () => setNavOpen(false);
  const workspace = { model, route, view, dialogs };

  return (
    <LibraryLayout
      reading={route.key() !== undefined}
      navOpen={navOpen()}
      mobileBar={
        <LibraryMobileBar
          navOpen={navOpen()}
          title={view.title()}
          onToggle={() => setNavOpen(!navOpen())}
        />
      }
      sidebar={<SidebarColumn {...workspace} onNavigate={closeNav} />}
      list={<ListColumn {...workspace} />}
      reader={<ReaderColumn {...workspace} />}
    >
      <LibraryDialogs model={model} route={route} dialogs={dialogs} />
      <LibraryToastView
        toast={model.state().toast}
        onDismiss={model.dismissToast}
      />
    </LibraryLayout>
  );
};

const LibraryPage = () => {
  const navigate = useNavigate();
  const session = authClient.useSession();
  createEffect(() => {
    const current = session();
    if (!current.isPending && !current.data && !current.error)
      navigate('/login', { replace: true });
  });

  return (
    <main class="min-h-dvh">
      <Show
        when={!session().isPending}
        fallback={
          <p class="p-6 text-sm text-base-content/70">正在确认登录状态…</p>
        }
      >
        <Show
          when={!session().error}
          fallback={
            <p role="alert" class="p-6 text-sm text-error">
              暂时无法确认登录状态，请刷新重试。
            </p>
          }
        >
          <Show when={session().data?.user.id}>
            <LibraryWorkspace />
          </Show>
        </Show>
      </Show>
    </main>
  );
};

export default LibraryPage;
