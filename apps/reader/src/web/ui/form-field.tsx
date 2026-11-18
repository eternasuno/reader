import { type ComponentProps, splitProps } from 'solid-js';
import { Input } from './input';

export type FormFieldProps = Omit<
  ComponentProps<'input'>,
  'children' | 'class'
> & {
  readonly id: string;
  readonly label: string;
  /**
   * The hint under the field, which doubles as its message: it is shown, styled
   * as an error tooltip, when the field is invalid after a submit attempt. The
   * form adds the `submitted` class to itself on its first submit, so an
   * untouched page shows no message (account.md Interface).
   */
  readonly hint: string;
};

/** A labeled, validated text field: `Input` with its label and its message. */
export const FormField = (props: FormFieldProps) => {
  const [local, inputProps] = splitProps(props, ['label', 'hint']);

  return (
    <fieldset class="fieldset">
      <label class="label" for={props.id}>
        {local.label}
      </label>
      <div class="w-full tooltip-error has-[:user-invalid]:tooltip [form.submitted_&:has(:invalid)]:tooltip">
        <div
          id={`${props.id}-hint`}
          role="tooltip"
          class="tooltip-content hidden [div:has(:user-invalid)>&]:block [form.submitted_div:has(:invalid)>&]:block"
        >
          {local.hint}
        </div>
        <Input
          {...inputProps}
          class="validator w-full [form.submitted_&:invalid]:input-error [form.submitted_&:invalid]:border-error [form.submitted_&:invalid]:outline-error"
          aria-describedby={[props['aria-describedby'], `${props.id}-hint`]
            .filter(Boolean)
            .join(' ')}
        />
      </div>
    </fieldset>
  );
};
