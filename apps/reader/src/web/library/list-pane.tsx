import { Show } from 'solid-js';
import { feedIdsInFolder } from '../folder';
import { openAddLink } from '../saved-page';
import { VirtualList } from '../ui/virtual-list';
import { ArticleRow } from './article-row';
import { listState, loadNextPage, retryList } from './list';
import { ListHeading } from './list-heading';
import { ListEmpty, ListError, ListFailed, ListLoading } from './list-states';
import { type EmptyAction, type EmptyCopy, emptyCopy } from './messages';
import { setArticleRead } from './read';
import { currentScope, openArticleId, setUnreadFilter } from './route';
import type { Article, Scope } from './scope';
import { scopeName, scopeUnreadCount } from './scope-meta';

const folderHasFeeds = (scope: Scope): boolean =>
  scope.kind === 'folder' && feedIdsInFolder(scope.id).length > 0;

const runEmptyAction = (action: EmptyAction): void => {
  if (action === 'show-all') setUnreadFilter(false);
  else openAddLink();
};

const ListPlaceholder = (props: { readonly empty: EmptyCopy }) => {
  const state = () => listState();

  return (
    <Show when={state().error === undefined} fallback={<ListFailed />}>
      <Show
        when={state().initialized && !state().loading}
        fallback={<ListLoading />}
      >
        <ListEmpty empty={props.empty} onAction={runEmptyAction} />
      </Show>
    </Show>
  );
};

const ListBody = () => {
  const state = () => listState();
  const empty = () =>
    emptyCopy(state().scope, state().unread, folderHasFeeds(state().scope));
  const toggleRead = (article: Article) =>
    void setArticleRead(article, !article.item.read);

  return (
    <>
      <Show when={state().error}>
        {(message) => (
          <ListError message={message()} onRetry={() => void retryList()} />
        )}
      </Show>
      <Show
        when={state().rows.length > 0}
        fallback={<ListPlaceholder empty={empty()} />}
      >
        <VirtualList
          items={state().rows}
          getKey={(article) => article.item.id}
          estimateSize={124}
          onEndReached={() => void loadNextPage()}
        >
          {(article) => (
            <ArticleRow
              article={article}
              selected={openArticleId() === article.item.id}
              onToggleRead={toggleRead}
            />
          )}
        </VirtualList>
      </Show>
    </>
  );
};

/** The list column of the selected scope (library.md Interface, List pane). */
export const ListPane = () => (
  <div class="flex h-full min-h-0 flex-col">
    <ListHeading
      name={scopeName(currentScope())}
      count={scopeUnreadCount(currentScope())}
    />
    <ListBody />
  </div>
);
