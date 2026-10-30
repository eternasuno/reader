import { type JSX, Show } from 'solid-js';
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
  readonly menuActions?: ((close: () => void) => JSX.Element) | undefined;
};

export const SourceNavRow = (props: SourceNavRowProps) => (
  <li
    class="group/nav relative rounded"
    aria-busy={props.pending !== undefined}
  >
    <NavButton
      class="w-full gap-3 pr-10"
      active={props.active}
      onClick={props.onPick}
    >
      <ReaderIcon
        name={props.icon}
        class={`size-5 ${props.active ? 'text-neutral-content' : 'text-base-content/65'}`}
      />
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
      actions={props.menuActions}
    />
    <Show when={props.error}>
      {(message) => (
        <p role="alert" class="px-2.5 pb-1 text-xs text-error">
          {message()}
        </p>
      )}
    </Show>
  </li>
);
