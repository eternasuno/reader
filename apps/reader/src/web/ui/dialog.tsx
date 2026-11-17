import { createEffect, type JSX } from 'solid-js';
import { Button } from './button';
import { Icon } from './icon';

export type DialogProps = {
  /** Drives the native modal: `showModal()` when true, `close()` when false. */
  readonly open: boolean;
  /** The accessible name of the dialog. */
  readonly label: string;
  /** Called on every close, including Esc and the close button. */
  readonly onClose: () => void;
  readonly children: JSX.Element;
};

/**
 * The shared controlled native dialog (ui.md): Esc, the close button and the
 * return of focus to the invoker come from the native `<dialog>`, so a screen
 * that composes it inherits them. The invoking popover closes before the dialog
 * opens; what the dialog does on success or failure is `reader-spec`.
 */
export const Dialog = (props: DialogProps) => {
  let ref!: HTMLDialogElement;

  createEffect(() => {
    if (props.open) ref.showModal();
    else ref.close();
  });

  return (
    <dialog
      ref={(element) => {
        ref = element;
      }}
      onClose={props.onClose}
      aria-label={props.label}
      class="modal"
    >
      <div class="modal-box max-h-[85dvh] max-w-xl">
        <form method="dialog" class="flex justify-end">
          <Button
            type="submit"
            class="btn btn-ghost min-h-11 px-3 py-2"
            aria-label="关闭"
          >
            <Icon name="close" />
          </Button>
        </form>
        {props.children}
      </div>
    </dialog>
  );
};
