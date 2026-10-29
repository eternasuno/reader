import { Show } from 'solid-js';
import { NavButton } from '../atoms/nav-item';
import { ReaderIcon } from '../atoms/reader-icon';
import { NavMenu, NavMenuMeta } from './nav-menu';

type SourceNavRowProps = {
  readonly icon: Parameters<typeof ReaderIcon>[0]['name'];
  readonly label: string;
  readonly active: boolean;
  readonly count: number | undefined;
  readonly busy: boolean;
  readonly onlyUnread: boolean;
  readonly pending: string | undefined;
  readonly error: string | undefined;
  readonly onPick: () => void;
  readonly onRefresh: () => void;
  readonly onMarkAll: () => void;
  readonly onOnlyUnreadChange: (value: boolean) => void;
};

export const SourceNavRow = (props: SourceNavRowProps) => (
  <div class="group/nav relative shrink-0 rounded">
    <NavButton
      class={`w-full gap-3 ${props.pending === undefined ? 'pr-2.5 pointer-coarse:pr-10' : 'pr-10'}`}
      active={props.active}
      onClick={props.onPick}
    >
      <ReaderIcon name={props.icon} class="w-5 shrink-0 text-[#aaa3b2]" />
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <NavMenuMeta pending={props.pending} count={props.count} />
    </NavButton>
    <NavMenu
      label={props.label}
      active={props.active}
      busy={props.busy}
      onlyUnread={props.onlyUnread}
      onRefresh={props.onRefresh}
      onMarkAll={props.onMarkAll}
      onOnlyUnreadChange={props.onOnlyUnreadChange}
    />
    <Show when={props.error}>
      {(message) => (
        <p role="alert" class="px-2.5 pb-1 text-xs text-error">
          {message()}
        </p>
      )}
    </Show>
  </div>
);
