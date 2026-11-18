import { Icon } from './icon';

export type MenuRadioProps = {
  /** The radios of one group share a name, so arrow keys move inside it. */
  readonly name: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly label: string;
};

/**
 * A menu choice with native radio semantics, the sibling of `MenuCheckbox`:
 * the radio stays in the DOM, visually hidden but focusable, and the `Icon`
 * circle / circleDot pair is what the user sees (ui.md).
 */
export const MenuRadio = (props: MenuRadioProps) => (
  <label class="flex cursor-pointer items-center gap-2">
    <input
      type="radio"
      class="peer sr-only"
      name={props.name}
      checked={props.checked}
      onChange={(event) => {
        if (event.currentTarget.checked) props.onSelect();
      }}
    />
    <span class="inline-flex rounded-full text-base-content/65 peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-primary">
      <Icon name={props.checked ? 'circleDot' : 'circle'} />
    </span>
    {props.label}
  </label>
);
