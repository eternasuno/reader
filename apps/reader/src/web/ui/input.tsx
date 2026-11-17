import { type ComponentProps, splitProps } from 'solid-js';

/**
 * The only text-field base (ui.md). It keeps idle borders and backgrounds
 * visible, styles the invalid (and invalid-and-focused) state, and leaves the
 * native attributes and Solid's reactive props untouched. A labeled field
 * composes it through `FormField`; a menu toggle uses `MenuCheckbox` instead.
 */
export const Input = (props: ComponentProps<'input'>) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <input
      {...rest}
      class={`input border border-base-content/40 bg-base-200 text-base-content placeholder:text-base-content/60 focus:border-primary focus:outline-primary user-invalid:border-error user-invalid:outline-error user-invalid:focus:border-error user-invalid:focus:outline-error disabled:border-base-content/20 disabled:text-base-content/40 disabled:placeholder:text-base-content/40 ${local.class ?? ''}`}
    />
  );
};
