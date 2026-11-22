import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import type { Feed, Folder } from '../api';
import {
  buildLibraryUrl,
  type LibraryScope,
  loadError,
  loadingInitial,
  rows,
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
  onNavigate: (url: string) => void;
  onRequestAddLink: () => void;
  onRequestAddFeed: () => void;
  onRequestRenameFolder: (folder: Folder) => void;
  onRequestMoveFeed: (feed: Feed) => void;
}

/**
 * `library.md`: scope heading (title + count + tools), list states, and the
 * virtualized article rows.
 */
export function ArticleListPane(props: ArticleListPaneProps): JSX.Element {
  const copy = () =>
    emptyCopy(props.scope, props.onRequestAddLink, props.onRequestAddFeed);
  const removeFeed = (feed: Feed): void => {
    void deleteFeed(
      {
        scope: props.scope,
        unreadOnly: props.unreadOnly,
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
  const isEmpty = () =>
    !loadingInitial() && loadError() === null && rows().length === 0;

  return (
    <section
      class="flex h-full min-h-0 flex-col border-base-300 md:border-r"
      aria-label={scopeTitle(props.scope)}
    >
      <ArticleListHeader
        scope={props.scope}
        unreadOnly={props.unreadOnly}
        onToggleUnread={toggleUnread}
        onRequestAddLink={props.onRequestAddLink}
        onRequestMoveFeed={props.onRequestMoveFeed}
        onDeleteFeed={removeFeed}
      />
      <Show when={loadError() !== null}>
        <ArticleListError />
      </Show>
      <Show when={loadingInitial() && rows().length === 0}>
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
      <Show when={rows().length > 0}>
        <ArticleListBody
          rows={rows()}
          scope={props.scope}
          unreadOnly={props.unreadOnly}
          openArticleId={props.openArticleId}
          onNavigate={props.onNavigate}
        />
      </Show>
    </section>
  );
}
