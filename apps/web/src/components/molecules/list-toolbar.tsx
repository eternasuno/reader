import { createUniqueId, Show } from 'solid-js';
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
    <nav class="workspace-list-heading" aria-label={`${props.title}清单工具`}>
      <h2 tabindex="-1">{props.title}</h2>
      <span class="list-loaded-count" title="当前页已加载条目数">
        {props.count === undefined ? '加载中' : `已加载 ${props.count} 项`}
      </span>
      <Show when={props.onAdd}>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label="添加链接"
          title="添加链接"
          onClick={() => props.onAdd?.()}
        >
          <ReaderIcon name="plus" />
        </button>
      </Show>
      <ListOptions {...props} />
    </nav>
  );
};

const ListOptions = (props: ListToolbarProps) => {
  const id = createUniqueId();
  let menu!: HTMLUListElement;

  return (
    <>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square"
        aria-label="清单选项"
        title="清单选项"
        popovertarget={id}
        style={{ 'anchor-name': `--${id}` }}
      >
        <ReaderIcon name="more" />
      </button>
      <ul
        ref={menu}
        id={id}
        popover="auto"
        class="dropdown menu list-options rounded-box bg-base-200 shadow-lg"
        style={{ 'position-anchor': `--${id}` }}
      >
        <ListOptionItems {...props} close={() => menu.hidePopover()} />
      </ul>
    </>
  );
};

export const EntryTime = (props: { readonly value: string }) => {
  const label = () => {
    const seconds = Math.max(0, (Date.now() - Date.parse(props.value)) / 1000);
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
    if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}天前`;
    return new Date(props.value).toLocaleDateString('zh-CN');
  };
  return (
    <time datetime={props.value} title={new Date(props.value).toLocaleString()}>
      {label()}
    </time>
  );
};

const ListOptionItems = (
  props: ListToolbarProps & { readonly close: () => void }
) => (
  <>
    <li>
      <button
        type="button"
        disabled={props.pending}
        onClick={() => {
          props.onRefresh();
          props.close();
        }}
      >
        刷新已存清单
      </button>
    </li>
    <Show when={props.onRefreshFeed}>
      <li>
        <button
          type="button"
          disabled={props.pending}
          onClick={() => {
            props.onRefreshFeed?.();
            props.close();
          }}
        >
          刷新订阅源
        </button>
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
        <button
          type="button"
          disabled={props.pending}
          aria-pressed={!props.read}
          onClick={() => filter(false)}
        >
          未读 {props.read ? '' : '✓'}
        </button>
      </li>
      <li>
        <button
          type="button"
          disabled={props.pending}
          aria-pressed={props.read}
          onClick={() => filter(true)}
        >
          已读 {props.read ? '✓' : ''}
        </button>
      </li>
    </>
  );
};
