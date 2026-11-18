import { For } from 'solid-js';
import { folders } from './list';

export type FolderSelectProps = {
  readonly id: string;
  /** The chosen folder; undefined is `不放入目录`, the top level. */
  readonly value: string | undefined;
  readonly disabled?: boolean;
  readonly onChange: (folderId: string | undefined) => void;
};

/**
 * The `目录` select of the move dialog and of the subscribe confirmation
 * (folders.md): `不放入目录` first, then the folders in the server's order.
 */
export const FolderSelect = (props: FolderSelectProps) => (
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
        const chosen = event.currentTarget.value;

        props.onChange(chosen === '' ? undefined : chosen);
      }}
    >
      <option value="">不放入目录</option>
      <For each={folders()}>
        {(folder) => <option value={folder.id}>{folder.name}</option>}
      </For>
    </select>
  </fieldset>
);
