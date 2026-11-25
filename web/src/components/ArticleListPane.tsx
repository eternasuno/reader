import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import type { Feed } from '../api';
import {
  buildLibraryUrl,
  type LibraryScope,
  loadError,
  loadingInitial,
  rowIds,
} from '../state';
import { ArticleListBody } from './ArticleListBody';
import { ArticleListHeader } from './ArticleListHeader';
import {
  ArticleListEmpty,
  ArticleListError,
  ArticleListLoading,
} from './ArticleListStates';
import { deleteFeed } from './articleListActions';
import { emptyCopy, scopeTitle } from './articleListScope';

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
  onRequestFeedOptions?: (feed: Feed) => void;
}

function ArticleListContent(props: ArticleListPaneProps): JSX.Element {
  const copy = () =>
    emptyCopy(props.scope, props.onRequestAddLink, props.onRequestAddFeed);
  const isEmpty = () =>
    !loadingInitial() && loadError() === null && rowIds().length === 0;

  return (
    <>
      <Show when={loadError() !== null}>
        <ArticleListError />
      </Show>
      <Show when={loadingInitial() && rowIds().length === 0}>
        <ArticleListLoading />
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
        <ArticleListBody
          ids={rowIds()}
          scope={props.scope}
          unreadOnly={props.unreadOnly}
          openArticleId={props.openArticleId}
          onNavigate={props.onNavigate}
        />
      </Show>
    </>
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
        onRequestFeedOptions={props.onRequestFeedOptions}
        onDeleteFeed={removeFeed}
      />
      <ArticleListContent {...props} />
    </section>
  );
}
