import { For } from 'solid-js';
import { Button } from '../atoms/button';

type ReadingFilterTabsProps = {
  read: boolean;
  pending: boolean;
  onSelect: (value: boolean) => void;
};

const tabClass = (active: boolean): string =>
  `pb-4 text-sm border-b-2 ${active ? 'border-base-content font-semibold' : 'border-transparent text-base-content/50'}`;

const ReadingTabButton = (
  props: ReadingFilterTabsProps & { value: boolean }
) => {
  const active = () => props.read === props.value;
  const select = () => props.onSelect(props.value);
  return (
    <Button
      type="button"
      class={tabClass(active())}
      aria-pressed={active()}
      onClick={select}
      disabled={props.pending}
    >
      {props.value ? '已读' : '未读'}
    </Button>
  );
};

export const ReadingFilterTabs = (props: ReadingFilterTabsProps) => (
  <nav class="flex gap-7 border-b border-base-300" aria-label="阅读状态">
    <For each={[false, true]}>
      {(value) => (
        <ReadingTabButton
          read={props.read}
          pending={props.pending}
          onSelect={props.onSelect}
          value={value}
        />
      )}
    </For>
  </nav>
);
