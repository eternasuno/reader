import { createEffect, type JSX } from 'solid-js';
import { Button } from '../atoms/button';
import { ReaderIcon } from '../atoms/reader-icon';

export const Dialog = (props: {
  readonly open: boolean;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: JSX.Element;
}) => {
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
            <ReaderIcon name="close" />
          </Button>
        </form>
        {props.children}
      </div>
    </dialog>
  );
};
