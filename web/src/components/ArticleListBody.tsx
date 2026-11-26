import type { JSX } from '@solidjs/web';
import { createProjection, Show } from 'solid-js';
import { t } from '../i18n';
import {
  articleById,
  type LibraryScope,
  loadingMore,
  loadNextPage,
} from '../state';
import { VirtualList } from '../ui';
import { ArticleRow } from './ArticleRow';

export interface ArticleListBodyProps {
  /** Ordered article IDs of the loaded list. */
  ids: ReadonlyArray<string>;
  scope: LibraryScope;
  unreadOnly: boolean;
  openArticleId: string | null;
  onNavigate: (url: string) => void;
}

/**
 * `LIB-VIEW-1`: the virtualized rows plus the infinite-scroll footer. Rows are keyed by article ID
 * and read their record fields directly, so a field change never rebuilds a row.
 */
export function ArticleListBody(props: ArticleListBodyProps): JSX.Element {
  const activeIndex = (): number =>
    props.openArticleId === null ? -1 : props.ids.indexOf(props.openArticleId);
  const active = createProjection<Record<string, boolean>>((draft) => {
    const openId = props.openArticleId;
    for (const id of Object.keys(draft)) {
      if (id !== openId) delete draft[id];
    }
    if (openId !== null) draft[openId] = true;
  }, {});

  return (
    <VirtualList
      keys={props.ids}
      estimateSize={136}
      activeKey={props.openArticleId}
      activeIndex={activeIndex()}
      onEndReached={() => void loadNextPage()}
      class="min-h-0 flex-1"
      renderItem={(id) => (
        <Show when={articleById(id)}>
          {(row) => (
            <ArticleRow
              row={row()}
              scope={props.scope}
              unreadOnly={props.unreadOnly}
              active={active[id] === true}
              onNavigate={props.onNavigate}
            />
          )}
        </Show>
      )}
      footer={
        <Show when={loadingMore()}>
          <p
            class="px-3 py-3 text-center text-xs text-base-content/50"
            role="status"
          >
            {t('library.loading')}
          </p>
        </Show>
      }
    />
  );
}
