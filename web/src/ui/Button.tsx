import type { JSX } from '@solidjs/web';
import { omit, Show } from 'solid-js';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'icon';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps
  extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'class'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  /** Shows a spinner and disables the button while an action is in flight. */
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-error',
  icon: 'btn-ghost btn-square',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
};

const FOCUS_CLASSES =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100';

export function Button(props: ButtonProps): JSX.Element {
  const rest = omit(props, 'variant', 'size', 'class', 'loading', 'children');

  return (
    <button
      {...rest}
      type={props.type ?? 'button'}
      disabled={props.disabled || props.loading}
      aria-busy={props.loading ? 'true' : undefined}
      class={[
        'btn',
        VARIANT_CLASSES[props.variant ?? 'ghost'],
        SIZE_CLASSES[props.size ?? 'md'],
        FOCUS_CLASSES,
        props.class,
      ]}
    >
      <Show when={props.loading}>
        <span class="loading loading-spinner loading-xs" aria-hidden="true" />
      </Show>
      {props.children}
    </button>
  );
}
