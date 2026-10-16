import { type ComponentProps, splitProps } from 'solid-js';

type FormInputProps = Omit<ComponentProps<'input'>, 'children' | 'class'> & {
  id: string;
  label: string;
  hint: string;
};

export const FormInput = (props: FormInputProps) => {
  const [, inputProps] = splitProps(props, ['label', 'hint']);

  return (
    <fieldset class="fieldset">
      <label class="label" for={props.id}>
        {props.label}
      </label>
      <div class="w-full tooltip-error has-[:user-invalid]:tooltip [form.submitted_&:has(:invalid)]:tooltip">
        <div
          id={`${props.id}-hint`}
          role="tooltip"
          class="tooltip-content hidden [div:has(:user-invalid)>&]:block [form.submitted_div:has(:invalid)>&]:block"
        >
          {props.hint}
        </div>
        <input
          {...inputProps}
          class="input validator w-full [form.submitted_&:invalid]:input-error"
          aria-describedby={[props['aria-describedby'], `${props.id}-hint`]
            .filter(Boolean)
            .join(' ')}
        />
      </div>
    </fieldset>
  );
};
