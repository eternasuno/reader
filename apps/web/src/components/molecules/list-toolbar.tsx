import { Show } from 'solid-js';
import { IconButton } from '../atoms/icon-button';
import { ReaderIcon } from '../atoms/reader-icon';
import { NavMenuActions, PopoverMenu } from './nav-menu';

type ListToolbarProps = {
  readonly title: string;
  readonly unread: number | undefined;
  readonly loadedUnread: boolean;
  readonly onlyUnread: boolean;
  readonly pending: boolean;
  readonly error: string;
  readonly onRefresh: () => void;
  readonly onMarkAll: () => void;
  readonly onMarkLoaded: () => void;
  readonly onOnlyUnreadChange: (value: boolean) => void;
  readonly onAdd?: (() => void) | undefined;
};

export const ListToolbar = (props: ListToolbarProps) => (
  <>
    <nav
      class="workspace-list-heading flex h-13 shrink-0 items-center gap-2 border-b border-base-300 bg-base-100 px-4"
      aria-label={`${props.title}清单工具`}
    >
      <h2 class="min-w-0 truncate text-sm font-semibold" tabindex="-1">
        {props.title}
      </h2>
      <span
        class="mr-auto whitespace-nowrap text-xs tabular-nums text-base-content opacity-55"
        title="未读文章总数"
      >
        {props.unread === undefined ? '…' : props.unread}
        <span class="sr-only"> 篇未读文章</span>
      </span>
      <Show when={props.onAdd}>
        <IconButton
          label="添加链接"
          disabled={props.pending}
          onClick={() => props.onAdd?.()}
        >
          <ReaderIcon name="plus" />
        </IconButton>
      </Show>
      <IconButton
        label="将已加载文章标为已读"
        title="将已加载文章标为已读"
        disabled={props.pending || !props.loadedUnread}
        busy={props.pending}
        onClick={props.onMarkLoaded}
      >
        <ReaderIcon name="check" />
      </IconButton>
      <PopoverMenu
        label={`${props.title} 更多操作`}
        menuLabel={`${props.title} 操作`}
        triggerClass="inline-grid size-8 shrink-0 cursor-pointer place-items-center rounded-md bg-transparent p-0 text-base-content"
      >
        {(closeMenu) => (
          <NavMenuActions
            busy={props.pending}
            onlyUnread={props.onlyUnread}
            onRefresh={() => {
              closeMenu();
              props.onRefresh();
            }}
            onMarkAll={() => {
              closeMenu();
              props.onMarkAll();
            }}
            onOnlyUnreadChange={props.onOnlyUnreadChange}
          />
        )}
      </PopoverMenu>
    </nav>
    <Show when={props.error}>
      {(message) => (
        <p
          role="alert"
          class="shrink-0 border-b border-base-300 bg-base-100 px-4 py-2 text-xs text-error"
        >
          {message()}
        </p>
      )}
    </Show>
  </>
);
