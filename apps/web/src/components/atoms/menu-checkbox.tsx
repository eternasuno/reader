import { ReaderIcon } from './reader-icon';

export const MenuCheckbox = (props: {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
}) => (
  <label class="flex cursor-pointer items-center gap-2">
    <input
      type="checkbox"
      class="peer sr-only"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    />
    <span class="inline-flex rounded-sm text-base-content/65 peer-checked:text-primary peer-disabled:opacity-40 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-primary">
      <ReaderIcon name={props.checked ? 'squareCheck' : 'square'} />
    </span>
    {props.label}
  </label>
);
