import { For } from 'solid-js';
import type { Folder } from '../../lib/library';

export const FolderSelect = (props: {
  readonly id: string;
  readonly folders: ReadonlyArray<Folder>;
  readonly value: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: string | undefined) => void;
}) => (
  <fieldset class="fieldset">
    <label class="label" for={props.id}>
      目录
    </label>
    <select
      id={props.id}
      class="select w-full border border-base-content/40 bg-base-200 text-base-content focus:border-primary focus:outline-primary disabled:border-base-content/20 disabled:text-base-content/40"
      value={props.value ?? ''}
      disabled={props.disabled}
      onChange={(event) => {
        const value = event.currentTarget.value;
        props.onChange(value === '' ? undefined : value);
      }}
    >
      <option value="">不放入目录</option>
      <For each={props.folders}>
        {(folder) => <option value={folder.id}>{folder.name}</option>}
      </For>
    </select>
  </fieldset>
);
