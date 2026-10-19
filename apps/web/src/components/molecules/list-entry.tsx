import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Button } from '../atoms/button';

export const EntrySurface = (props: {
  readonly component: 'article' | 'li';
  readonly read: boolean;
  readonly selected?: boolean | undefined;
  readonly children: JSX.Element;
}) => (
  <Dynamic
    component={props.component}
    class="group relative flow-root -mx-6 px-7 py-4 hover:bg-base-content/5 data-[selected=true]:not-hover:bg-base-content/8"
    data-read={props.read ? 'true' : 'false'}
    data-selected={props.selected ? 'true' : undefined}
  >
    {props.children}
  </Dynamic>
);

export const EntryTitle = (props: {
  readonly href: string;
  readonly target?: string | undefined;
  readonly rel?: string | undefined;
  readonly current?: boolean | undefined;
  readonly onClick?: ((event: MouseEvent) => void) | undefined;
  readonly children: JSX.Element;
}) => (
  <a
    class="entry-title block wrap-anywhere text-sm font-[450] leading-[1.55] text-base-content after:absolute after:inset-0 after:content-[''] group-data-[read=false]:font-semibold"
    href={props.href}
    target={props.target}
    rel={props.rel}
    aria-current={props.current ? true : undefined}
    onClick={(event) => props.onClick?.(event)}
  >
    {props.children}
  </a>
);

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
    <time
      class="shrink-0"
      datetime={props.value}
      title={new Date(props.value).toLocaleString()}
    >
      {label()}
    </time>
  );
};

export const EntryMeta = (props: {
  readonly source: string;
  readonly time: string;
}) => (
  <p class="mb-1 flex items-center justify-between gap-3 text-xs leading-[1.6] text-base-content/55">
    <span class="min-w-0 truncate">{props.source}</span>
    <EntryTime value={props.time} />
  </p>
);

export const EntryUnreadButton = (props: {
  readonly label: string;
  readonly pending: boolean;
  readonly onMarkRead: () => void;
}) => (
  <Button
    type="button"
    class="absolute top-8 left-0 z-2 grid size-7 cursor-pointer place-items-center rounded-full bg-transparent text-base-content disabled:cursor-wait"
    aria-label={`标为已读：${props.label}`}
    title="标为已读"
    disabled={props.pending}
    onClick={() => {
      if (!props.pending) props.onMarkRead();
    }}
  >
    <span class="size-1.5 rounded-full bg-current opacity-70" />
  </Button>
);
