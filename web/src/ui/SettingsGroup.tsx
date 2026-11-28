import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';

/**
 * Grouped settings card: small uppercase heading (with optional trailing status),
 * divided rows, and an optional right-aligned footer for the group's actions.
 */
export function SettingsGroup(props: {
  title: string;
  aside?: JSX.Element;
  footer?: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  return (
    <section class="flex flex-col gap-2">
      <div class="flex min-h-6 items-center justify-between gap-2 px-1">
        <h2 class="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
          {props.title}
        </h2>
        {props.aside}
      </div>
      <div class="overflow-hidden rounded-box border border-base-300 bg-base-200/50">
        <div class="divide-y divide-base-300">{props.children}</div>
        <Show when={props.footer}>
          <div class="flex flex-wrap items-center justify-end gap-2 border-t border-base-300 bg-base-200 px-4 py-2.5">
            {props.footer}
          </div>
        </Show>
      </div>
    </section>
  );
}

/**
 * One settings row: label + description on the left, control on the right
 * (`stacked` puts the control below, for full-width fields and lists).
 */
export function SettingsRow(props: {
  label?: string;
  labelFor?: string;
  description?: string;
  stacked?: boolean;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div
      class={[
        'flex flex-col gap-3 px-4 py-3.5',
        props.stacked ? '' : 'sm:flex-row sm:items-center sm:justify-between',
      ]}
    >
      <Show when={props.label !== undefined || props.description !== undefined}>
        <div class="flex min-w-0 flex-col gap-0.5">
          <Show when={props.label}>
            {(label) => (
              <label for={props.labelFor} class="text-sm font-medium">
                {label()}
              </label>
            )}
          </Show>
          <Show when={props.description}>
            {(description) => (
              <p class="text-xs leading-relaxed text-base-content/60">
                {description()}
              </p>
            )}
          </Show>
        </div>
      </Show>
      <Show when={props.children}>
        <div class={props.stacked ? 'min-w-0' : 'shrink-0'}>
          {props.children}
        </div>
      </Show>
    </div>
  );
}

/** Small configured / not-configured pill for a settings group heading. */
export function StatusBadge(props: {
  on: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <span
      class={[
        'badge badge-sm gap-1.5 border-0 font-normal',
        props.on
          ? 'bg-success/15 text-success'
          : 'bg-base-300 text-base-content/60',
      ]}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}
