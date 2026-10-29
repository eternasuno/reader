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
    if (!props.open && ref.open) ref.close();
    else if (props.open && !ref.open) ref.showModal();
  });

  return (
    <dialog
      ref={(element) => {
        ref = element;
      }}
      onClose={props.onClose}
      aria-label={props.label}
      class="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-6 text-base-content shadow-2xl backdrop:bg-black/60"
    >
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
    </dialog>
  );
};
