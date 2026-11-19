import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { t } from '../i18n';
import {
  type LibraryArticle,
  type LibraryScope,
  loadingMore,
  loadNextPage,
} from '../state';
import { VirtualList } from '../ui';
import { ArticleRow } from './ArticleRow';

export interface ArticleListBodyProps {
  rows: ReadonlyArray<LibraryArticle>;
  scope: LibraryScope;
  unreadOnly: boolean;
  openArticleId: string | null;
  onNavigate: (url: string) => void;
}

/** `LIB-VIEW-1`: the virtualized rows plus the infinite-scroll footer. */
export function ArticleListBody(props: ArticleListBodyProps): JSX.Element {
  return (
    <VirtualList
      items={props.rows}
      estimateSize={112}
      onEndReached={() => void loadNextPage()}
      class="min-h-0 flex-1"
      renderItem={(row) => (
        <ArticleRow
          row={row}
          scope={props.scope}
          unreadOnly={props.unreadOnly}
          active={row.id === props.openArticleId}
          onNavigate={props.onNavigate}
        />
      )}
      footer={
        <Show when={loadingMore()}>
          <p
            class="px-3 py-3 text-center text-xs text-base-content/50"
            role="status"
          >
            {String(t('library.loading'))}
          </p>
        </Show>
      }
    />
  );
}
