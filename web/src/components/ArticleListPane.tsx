import type { JSX } from '@solidjs/web';
import { onSettled, Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  buildLibraryUrl,
  type LibraryScope,
  listBoundary,
  rowIds,
  snapshotError,
  snapshotLoading,
  windowError,
} from '../state';
import { registerListTransitionTarget } from '../ui';
import { ArticleListBody } from './ArticleListBody';
import { ArticleListHeader } from './ArticleListHeader';
import {
  ArticleListEmpty,
  ArticleListError,
  ArticleListLoading,
} from './ArticleListStates';
import { deleteFeed } from './articleListActions';
import { emptyCopy, isGroupedScope, scopeTitle } from './articleListScope';

export interface ArticleListPaneProps {
  scope: LibraryScope;
  openArticleId: string | null;
  unreadOnly: boolean;
  drawerOpen: boolean;
  onToggleNav: () => void;
  navToggleRef: (element: HTMLButtonElement) => void;
  onNavigate: (url: string) => void;
  onRequestAddLink: () => void;
  onRequestAddFeed: () => void;
  onMoveFeed: (feed: Feed, folderId: string | null) => Promise<void>;
  onRequestNewFolder: (feed: Feed) => void;
}

function ArticleListContent(props: ArticleListPaneProps): JSX.Element {
  const copy = () =>
    emptyCopy(props.scope, props.onRequestAddLink, props.onRequestAddFeed);
  const isEmpty = () =>
    !snapshotLoading() && snapshotError() === null && rowIds().length === 0;
  // The list area outlives emptying and refilling, so first rows and restored rows animate too.
  let area: HTMLDivElement | undefined;
  onSettled(() =>
    area === undefined ? undefined : registerListTransitionTarget(area)
  );

  return (
    <div
      ref={(element) => {
        area = element;
      }}
      class="flex min-h-0 flex-1 flex-col"
    >
      <Show when={listBoundary() === null && snapshotError() !== null}>
        <ArticleListError />
      </Show>
      <Show when={snapshotLoading() && rowIds().length === 0}>
        <ArticleListLoading
          grouped={isGroupedScope(props.scope)}
          label={t('library.loading')}
        />
      </Show>
      <Show when={isEmpty()}>
        <ArticleListEmpty
          scope={props.scope}
          unreadOnly={props.unreadOnly}
          copy={copy()}
          onNavigate={props.onNavigate}
        />
      </Show>
      <Show when={rowIds().length > 0}>
        <Show when={windowError() !== null}>
          <ArticleListError compact />
        </Show>
        <ArticleListBody
          ids={rowIds()}
          scope={props.scope}
          unreadOnly={props.unreadOnly}
          openArticleId={props.openArticleId}
          onNavigate={props.onNavigate}
        />
      </Show>
    </div>
  );
}

/**
 * `library.md`: scope heading (title + count + tools), list states, and the
 * virtualized article rows.
 */
export function ArticleListPane(props: ArticleListPaneProps): JSX.Element {
  const removeFeed = (feed: Feed): void => {
    void deleteFeed(
      {
        unreadOnly: () => props.unreadOnly,
        onNavigate: props.onNavigate,
      },
      feed
    );
  };
  const toggleUnread = (): void => {
    props.onNavigate(
      buildLibraryUrl(props.scope, { unreadOnly: !props.unreadOnly })
    );
  };

  return (
    <section
      class="flex h-full min-h-0 flex-col border-base-300 md:border-r"
      aria-label={scopeTitle(props.scope)}
    >
      <ArticleListHeader
        scope={props.scope}
        unreadOnly={props.unreadOnly}
        drawerOpen={props.drawerOpen}
        onToggleNav={props.onToggleNav}
        navToggleRef={props.navToggleRef}
        onToggleUnread={toggleUnread}
        onRequestAddLink={props.onRequestAddLink}
        onMoveFeed={props.onMoveFeed}
        onRequestNewFolder={props.onRequestNewFolder}
        onDeleteFeed={removeFeed}
      />
      <ArticleListContent {...props} />
    </section>
  );
}
