import { Show } from 'solid-js';
import type { Feed, Filter } from '../../lib/library';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { MenuCheckbox } from '../atoms/menu-checkbox';
import { ReaderIcon } from '../atoms/reader-icon';
import { PopoverMenu } from './popover-menu';

type LibraryToolbarProps = {
  readonly title: string;
  readonly unread: number;
  readonly filter: Filter;
  readonly busy: boolean;
  readonly loadedUnread: boolean;
  readonly currentFeed: Feed | undefined;
  readonly canAddArticle: boolean;
  readonly onFilter: (filter: Filter) => void;
  readonly onRefresh: () => void;
  readonly onMarkLoaded: () => void;
  readonly onMarkAll: () => void;
  readonly onAdd: () => void;
  readonly onUnsubscribe: (feed: Feed) => void;
};

const LibraryMenu = (props: LibraryToolbarProps) => (
  <PopoverMenu
    label="文章列表操作"
    trigger={(target) => (
      <IconButton label="文章列表菜单" popoverTarget={target}>
        <ReaderIcon name="more" />
      </IconButton>
    )}
  >
    {(close) => (
      <>
        <li>
          <MenuCheckbox
            label="只显示未读"
            checked={props.filter === 'unread'}
            onChange={(checked) => {
              close();
              props.onFilter(checked ? 'unread' : 'all');
            }}
          />
        </li>
        <li>
          <Button
            disabled={props.busy || (props.unread === 0 && !props.loadedUnread)}
            onClick={() => {
              close();
              props.onMarkAll();
            }}
          >
            <ReaderIcon name="checks" />
            全部标记为已读
          </Button>
        </li>
        <Show when={props.canAddArticle}>
          <li class="mt-2 border-t border-base-300 pt-2">
            <Button
              onClick={() => {
                close();
                props.onAdd();
              }}
            >
              <ReaderIcon name="plus" />
              新增文章链接
            </Button>
          </li>
        </Show>
        <Show when={props.currentFeed}>
          {(feed) => (
            <li>
              <Button
                class="text-error"
                disabled={props.busy}
                onClick={() => {
                  close();
                  props.onUnsubscribe(feed());
                }}
              >
                <ReaderIcon name="delete" />
                删除 RSS 源
              </Button>
            </li>
          )}
        </Show>
      </>
    )}
  </PopoverMenu>
);

export const LibraryToolbar = (props: LibraryToolbarProps) => (
  <nav
    class="workspace-list-heading flex min-h-13 shrink-0 items-center gap-2 border-b border-base-300 bg-base-100 px-4"
    aria-label={`${props.title}清单工具`}
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <h2 class="min-w-0 truncate text-sm font-semibold" tabindex="-1">
        {props.title}
      </h2>
      <span class="shrink-0 text-xs tabular-nums text-base-content/65">
        {props.unread}
        <span class="sr-only"> 篇未读</span>
      </span>
    </div>
    <IconButton
      label="刷新文章列表"
      disabled={props.busy}
      onClick={props.onRefresh}
    >
      <ReaderIcon name="refresh" />
    </IconButton>
    <IconButton
      label="将已加载文章标为已读"
      disabled={props.busy || !props.loadedUnread}
      busy={props.busy}
      onClick={props.onMarkLoaded}
    >
      <ReaderIcon name="markAbove" />
    </IconButton>
    <LibraryMenu {...props} />
  </nav>
);
