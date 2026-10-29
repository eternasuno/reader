import type { JSX } from 'solid-js';
import { Button } from './button';

export const IconButton = (props: {
  label: string;
  title?: string | undefined;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  popoverTarget?: string | undefined;
  anchorName?: string | undefined;
  ref?: ((element: HTMLButtonElement) => void) | undefined;
  onClick?: (() => void) | undefined;
  children: JSX.Element;
}) => (
  <Button
    ref={props.ref}
    type="button"
    class="inline-grid size-8 shrink-0 place-items-center border-0 bg-transparent p-0 text-base-content/85 shadow-none disabled:text-base-content/30 pointer-coarse:size-10"
    disabled={props.disabled}
    popovertarget={props.popoverTarget}
    style={props.anchorName ? `anchor-name:${props.anchorName}` : undefined}
    aria-label={props.label}
    title={props.title ?? props.label}
    aria-busy={props.busy}
    onClick={props.onClick}
  >
    {props.children}
  </Button>
);
