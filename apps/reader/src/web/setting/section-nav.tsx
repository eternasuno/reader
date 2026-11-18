import { For } from 'solid-js';
import { Button } from '../ui/button';
import { settingMessages as copy } from './messages';
import {
  type SettingsSection,
  sectionElementId,
  settingsSections,
} from './section';

export type SectionNavProps = {
  readonly section: SettingsSection;
  /** A write is in flight: every item is disabled with the busy text (settings.md). */
  readonly saving: boolean;
  /** Stacked layout: all four sections are on the page, so an item names its own. */
  readonly stacked: boolean;
  readonly onPick: (section: SettingsSection) => void;
  readonly elementRef: (element: HTMLElement) => void;
};

/**
 * The section navigation: it marks the open section, points each item at its
 * section and, beside the sections, switches them; stacked, an item scrolls to
 * its section (settings.md Interface).
 */
export const SectionNav = (props: SectionNavProps) => (
  <nav
    ref={props.elementRef}
    aria-label={copy.navigationLabel}
    aria-busy={props.saving}
    class="flex w-40 flex-none flex-col gap-1"
  >
    <For each={settingsSections}>
      {(item) => (
        <Button
          type="button"
          class={`btn btn-sm justify-start ${props.section === item.id ? 'btn-primary' : 'btn-ghost text-base-content/70'}`}
          aria-current={props.section === item.id ? 'true' : undefined}
          aria-controls={props.stacked ? sectionElementId(item.id) : undefined}
          title={props.saving ? copy.savingStatus : undefined}
          disabled={props.saving}
          onClick={() => props.onPick(item.id)}
        >
          {item.name}
        </Button>
      )}
    </For>
  </nav>
);
