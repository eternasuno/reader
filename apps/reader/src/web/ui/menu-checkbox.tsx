import { Icon } from './icon';

export type MenuCheckboxProps = {
  readonly checked: boolean;
  readonly disabled?: boolean | undefined;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
};

/**
 * A menu toggle with native checkbox semantics: the checkbox stays in the DOM,
 * visually hidden but focusable, and the `Icon` square / squareCheck pair is what
 * the user sees (ui.md). Never substitute a browser-styled checkbox.
 */
export const MenuCheckbox = (props: MenuCheckboxProps) => (
  <label class="flex cursor-pointer items-center gap-2">
    <input
      type="checkbox"
      class="peer sr-only"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    />
    <span class="inline-flex rounded-sm text-base-content/65 peer-checked:text-primary peer-disabled:opacity-40 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-primary">
      <Icon name={props.checked ? 'squareCheck' : 'square'} />
    </span>
    {props.label}
  </label>
);
