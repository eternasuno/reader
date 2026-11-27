import type { JSX } from '@solidjs/web';
import { createProjection, Show } from 'solid-js';
import { t } from '../i18n';
import {
  articleById,
  articleSource,
  groupStartIds,
  type LibraryScope,
  loadingMore,
  loadMore,
} from '../state';
import { VirtualList } from '../ui';
import { ArticleRow } from './ArticleRow';
import { SiteIcon } from './SiteIcon';

export interface ArticleListBodyProps {
  /** Ordered article IDs of the loaded list. */
  ids: ReadonlyArray<string>;
  scope: LibraryScope;
  unreadOnly: boolean;
  openArticleId: string | null;
  onNavigate: (url: string) => void;
}
function FeedGroupLabel(props: {
  id: string;
  scope: LibraryScope;
  title: string;
  iconSrcs: ReadonlyArray<string>;
}): JSX.Element {
  return (
    <Show
      when={
        (props.scope.kind === 'all' || props.scope.kind === 'folder') &&
        groupStartIds().has(props.id) &&
        props.title
      }
    >
      {(title) => (
        <div class="flex items-center gap-1.5 px-3 pt-3 pb-1 text-xs font-semibold text-base-content/50">
          <SiteIcon srcs={props.iconSrcs} fallback="rss" size={14} />
          <span class="min-w-0 flex-1 truncate">{title()}</span>
        </div>
      )}
    </Show>
  );
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
      onEndReached={() => void loadMore()}
      class="min-h-0 flex-1"
      renderItem={(id) => (
        <Show when={articleById(id)}>
          {(row) => (
            <>
              <FeedGroupLabel
                id={id}
                scope={props.scope}
                title={articleSource(row()).title}
                iconSrcs={articleSource(row()).iconSrcs}
              />
              <ArticleRow
                row={row()}
                scope={props.scope}
                unreadOnly={props.unreadOnly}
                active={active[id] === true}
                onNavigate={props.onNavigate}
              />
            </>
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
