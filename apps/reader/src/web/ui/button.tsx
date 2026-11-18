import { type JSX, Show, splitProps } from 'solid-js';

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** The filled daisyUI button, used by submits and primary actions. */
  readonly variant?: 'solid';
  /**
   * A submit or a remote action is in flight: the button is disabled, carries
   * `aria-busy` and shows its spinner (`reader-spec` Client conventions).
   */
  readonly busy?: boolean;
  /** The label shown while `busy`, when it differs from the button's text. */
  readonly pendingLabel?: string;
};

/**
 * The only component that renders a native `<button>` (ui.md). Ordinary buttons
 * share rounded-rectangle geometry, a pale hover background and a soft shadow;
 * the `solid` variant keeps the semantic daisyUI colors. `busy` is the one
 * pending state the UI has: a form submit, never a quick action.
 */
export const Button = (props: ButtonProps) => {
  const [local, rest] = splitProps(props, [
    'class',
    'variant',
    'busy',
    'pendingLabel',
    'children',
  ]);
  const busy = () => local.busy === true;

  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      disabled={busy() || rest.disabled === true}
      aria-busy={busy()}
      class={`cursor-pointer rounded-md! transition-[background-color,box-shadow] enabled:hover:shadow-md! disabled:cursor-not-allowed ${local.variant === 'solid' ? '' : 'enabled:hover:border-transparent! enabled:hover:bg-base-content/8!'} ${local.class ?? ''}`}
    >
      <Show when={busy()}>
        <span class="loading loading-spinner loading-sm" aria-hidden="true" />
      </Show>
      <Show
        when={busy() && local.pendingLabel !== undefined}
        fallback={local.children}
      >
        <span>{local.pendingLabel}</span>
      </Show>
    </button>
  );
};

export type IconButtonProps = {
  readonly label: string;
  readonly title?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly busy?: boolean | undefined;
  readonly pressed?: boolean | undefined;
  readonly expanded?: boolean | undefined;
  readonly popoverTarget?: string | undefined;
  readonly ref?: ((element: HTMLButtonElement) => void) | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly children: JSX.Element;
};

/** An icon-sized `Button`: a square target that grows on coarse pointers. */
export const IconButton = (props: IconButtonProps) => (
  <Button
    ref={props.ref}
    type="button"
    class="inline-grid size-8 shrink-0 place-items-center border-0 bg-transparent p-0 text-base-content/85 shadow-none disabled:text-base-content/30 pointer-coarse:size-11"
    disabled={props.disabled}
    popovertarget={props.popoverTarget}
    aria-label={props.label}
    title={props.title ?? props.label}
    aria-busy={props.busy}
    aria-pressed={props.pressed}
    aria-expanded={props.expanded}
    onClick={props.onClick}
  >
    {props.children}
  </Button>
);
