import { For } from 'solid-js';
import type { Filter } from '../../lib/library';
import { IconButton } from '../atoms/icon-button';
import { ReaderIcon } from '../atoms/reader-icon';

const filters: readonly { readonly value: Filter; readonly label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' },
];

const toFilter = (value: string): Filter =>
  value === 'unread' || value === 'read' ? value : 'all';

export const LibraryToolbar = (props: {
  readonly title: string;
  readonly unread: number;
  readonly filter: Filter;
  readonly busy: boolean;
  readonly loadedUnread: boolean;
  readonly onFilter: (filter: Filter) => void;
  readonly onMarkLoaded: () => void;
  readonly onMarkAll: () => void;
  readonly onAdd: () => void;
}) => (
  <nav
    class="workspace-list-heading flex h-13 shrink-0 items-center gap-2 border-b border-base-300 bg-base-100 px-4"
    aria-label={`${props.title}清单工具`}
  >
    <h2 class="min-w-0 truncate text-sm font-semibold" tabindex="-1">
      {props.title}
    </h2>
    <span
      class="whitespace-nowrap text-xs tabular-nums text-base-content/60"
      title="未读文章总数"
    >
      {props.unread}
      <span class="sr-only"> 篇未读文章</span>
    </span>
    <div class="ml-auto flex items-center gap-1">
      <label class="sr-only" for="library-filter">
        筛选文章
      </label>
      <select
        id="library-filter"
        class="select select-xs w-20"
        value={props.filter}
        onChange={(event) =>
          props.onFilter(toFilter(event.currentTarget.value))
        }
      >
        <For each={filters}>
          {(filter) => <option value={filter.value}>{filter.label}</option>}
        </For>
      </select>
      <IconButton
        label="将已加载文章标为已读"
        title="将已加载文章标为已读"
        disabled={props.busy || !props.loadedUnread}
        busy={props.busy}
        onClick={props.onMarkLoaded}
      >
        <ReaderIcon name="markAbove" />
      </IconButton>
      <IconButton
        label="全部标记为已读"
        title="全部标记为已读"
        disabled={props.busy}
        busy={props.busy}
        onClick={props.onMarkAll}
      >
        <ReaderIcon name="checks" />
      </IconButton>
      <IconButton
        label="添加链接或订阅"
        title="添加链接或订阅"
        onClick={props.onAdd}
      >
        <ReaderIcon name="plus" />
      </IconButton>
    </div>
  </nav>
);
