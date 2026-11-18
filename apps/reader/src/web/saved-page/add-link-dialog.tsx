import { useNavigate } from '@solidjs/router';
import { createEffect, createSignal } from 'solid-js';
import { scopePath, unreadFilter } from '../library';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { FormField } from '../ui/form-field';
import { addLink, addLinkOpen, closeAddLink } from './add-link';
import { savedPageMessages as copy } from './messages';

type AddLinkFormProps = {
  /** The request is in flight: the field and the button are disabled. */
  readonly pending: boolean;
  /** Receives the form, so the dialog can empty it when it opens. */
  readonly ref: (form: HTMLFormElement) => void;
  readonly onSubmit: (form: HTMLFormElement) => void;
};

/**
 * The URL field of the add dialog: a required `url` field, so a clearly
 * malformed value is refused by native validation before any request
 * (later.md Interface).
 */
const AddLinkForm = (props: AddLinkFormProps) => (
  <form
    ref={props.ref}
    method="post"
    novalidate
    aria-busy={props.pending}
    class="mt-4 flex flex-col gap-4"
    onSubmit={(event) => {
      event.preventDefault();

      const form = event.currentTarget;

      form.classList.add('submitted');

      if (!form.checkValidity() || props.pending) return;

      props.onSubmit(form);
    }}
  >
    <fieldset class="flex flex-col gap-4" disabled={props.pending}>
      <FormField
        id="add-link-url"
        name="url"
        type="url"
        required
        label={copy.urlLabel}
        hint={copy.urlHint}
        placeholder={copy.urlPlaceholder}
      />
      <Button
        type="submit"
        variant="solid"
        class="btn btn-neutral whitespace-nowrap"
        busy={props.pending}
        pendingLabel={copy.addPending}
      >
        {copy.addSubmit}
      </Button>
    </fieldset>
  </form>
);

/**
 * The shared add dialog in article mode (later.md Interface): one required URL
 * field, no preview step and no folder choice. The library mounts it once;
 * opening it empties the field, Esc and the close button cancel, and the form
 * closes the dialog, shows the toast and opens the new page on success.
 */
export const AddLinkDialog = () => {
  const navigate = useNavigate();
  const [pending, setPending] = createSignal(false);
  let form: HTMLFormElement | undefined;

  createEffect(() => {
    if (addLinkOpen()) form?.reset();
  });

  const openPage = (id: string) =>
    navigate(
      scopePath({ kind: 'later' }, { unread: unreadFilter(), articleId: id })
    );

  const submit = async (url: string) => {
    setPending(true);

    try {
      await addLink(url, openPage);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={addLinkOpen()} label={copy.addTitle} onClose={closeAddLink}>
      <section class="py-2">
        <h2 class="text-lg font-semibold tracking-tight">{copy.addTitle}</h2>
        <p class="mt-2 text-sm text-base-content/60">{copy.addDescription}</p>
        <AddLinkForm
          pending={pending()}
          ref={(element) => {
            form = element;
          }}
          onSubmit={(submitted) =>
            void submit(String(new FormData(submitted).get('url') ?? '').trim())
          }
        />
      </section>
    </Dialog>
  );
};
