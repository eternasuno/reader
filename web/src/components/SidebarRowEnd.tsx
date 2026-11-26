import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { t } from '../i18n';
import { COUNT_CLASSES } from './sidebarClasses';

/** Informational daisyUI spinner for an in-flight pessimistic mark-all operation. */
export function MarkingIndicator(props: { class?: string }): JSX.Element {
  return (
    <span
      role="status"
      aria-busy="true"
      aria-label={t('library.markingAllRead')}
      class={['loading loading-spinner loading-xs', props.class]}
    />
  );
}

/**
 * Library `Sidebar` rule: a row's unread count and its `⋯` menu share one slot; hovering or
 * focusing the row swaps the count (or mark-all spinner) for the menu on every device.
 * Rows using it carry the `group` class (`ROW_CLASSES`).
 */
export function SidebarRowEnd(props: {
  count: number;
  marking?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="grid shrink-0 place-items-center *:col-start-1 *:row-start-1">
      <Show
        when={!props.marking}
        fallback={
          <MarkingIndicator class="pointer-events-none opacity-60 group-focus-within:opacity-0 group-hover:opacity-0" />
        }
      >
        <Show when={props.count > 0}>
          <span
            class={[
              COUNT_CLASSES,
              'pointer-events-none group-focus-within:opacity-0 group-hover:opacity-0',
            ]}
          >
            {props.count}
          </span>
        </Show>
      </Show>
      <div class="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        {props.children}
      </div>
    </div>
  );
}
