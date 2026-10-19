import { createUniqueId, type JSX, Show } from 'solid-js';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { ReaderIcon } from '../atoms/reader-icon';

type ListToolbarProps = {
  readonly title: string;
  readonly count: number | undefined;
  readonly read: boolean;
  readonly pending: boolean;
  readonly onFilter: (read: boolean) => void;
  readonly onRefresh: () => void;
  readonly onRefreshFeed?: (() => void) | undefined;
  readonly onAdd?: (() => void) | undefined;
};

export const ListToolbar = (props: ListToolbarProps) => {
  return (
    <nav
      class="workspace-list-heading sticky top-0 z-3 flex h-13 items-center gap-2 -mx-6 border-b border-base-300 bg-base-100 px-4"
      aria-label={`${props.title}清单工具`}
    >
      <h2 class="min-w-0 truncate text-sm font-semibold" tabindex="-1">
        {props.title}
      </h2>
      <span
        class="mr-auto whitespace-nowrap text-xs text-base-content opacity-55"
        title="当前页已加载条目数"
      >
        {props.count === undefined ? '加载中' : `已加载 ${props.count} 项`}
      </span>
      <Show when={props.onAdd}>
        <IconButton label="添加链接" onClick={() => props.onAdd?.()}>
          <ReaderIcon name="plus" />
        </IconButton>
      </Show>
      <ListOptions {...props} />
    </nav>
  );
};

const ListOptions = (props: ListToolbarProps) => {
  const id = createUniqueId();
  const anchor = { '--menu-anchor': `--${id}` } as JSX.CSSProperties;
  let menu!: HTMLUListElement;

  return (
    <>
      <IconButton label="清单选项" popoverTarget={id} anchorName={`--${id}`}>
        <ReaderIcon name="more" />
      </IconButton>
      <ul
        ref={menu}
        id={id}
        popover="auto"
        class="dropdown menu fixed inset-auto top-[anchor(bottom)] right-[anchor(right)] z-10 my-1 w-44 rounded-box bg-base-200 shadow-lg [position-anchor:var(--menu-anchor)]"
        style={anchor}
      >
        <ListOptionItems {...props} close={() => menu.hidePopover()} />
      </ul>
    </>
  );
};

const ListOptionItems = (
  props: ListToolbarProps & { readonly close: () => void }
) => (
  <>
    <li>
      <Button
        type="button"
        disabled={props.pending}
        onClick={() => {
          props.onRefresh();
          props.close();
        }}
      >
        刷新已存清单
      </Button>
    </li>
    <Show when={props.onRefreshFeed}>
      <li>
        <Button
          type="button"
          disabled={props.pending}
          onClick={() => {
            props.onRefreshFeed?.();
            props.close();
          }}
        >
          刷新订阅源
        </Button>
      </li>
    </Show>
    <ListReadOptions {...props} />
  </>
);

const ListReadOptions = (
  props: ListToolbarProps & { readonly close: () => void }
) => {
  const filter = (read: boolean) => {
    props.onFilter(read);
    props.close();
  };

  return (
    <>
      <li>
        <Button
          type="button"
          disabled={props.pending}
          aria-pressed={!props.read}
          onClick={() => filter(false)}
        >
          未读 {props.read ? '' : '✓'}
        </Button>
      </li>
      <li>
        <Button
          type="button"
          disabled={props.pending}
          aria-pressed={props.read}
          onClick={() => filter(true)}
        >
          已读 {props.read ? '✓' : ''}
        </Button>
      </li>
    </>
  );
};
