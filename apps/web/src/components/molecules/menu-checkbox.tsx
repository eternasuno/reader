import { ReaderIcon } from '../atoms/reader-icon';

export const MenuCheckbox = (props: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) => (
  <label class="flex w-full cursor-pointer items-center justify-start gap-3 px-3 py-2 text-left has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40">
    <input
      type="checkbox"
      class="peer sr-only"
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    />
    <ReaderIcon
      name={props.checked ? 'squareCheck' : 'square'}
      class="size-5 text-base-content/65 peer-checked:text-primary peer-focus-visible:rounded-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-primary"
    />
    <span>{props.label}</span>
  </label>
);
