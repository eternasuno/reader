import { createSignal } from 'solid-js';
import { accountMessages } from '../account/messages';
import type { Confirm } from './confirm';
import { settingMessages as copy } from './messages';

/** The three sections of `/settings`, in page order (settings.md Interface). */
export type SettingsSection = 'account' | 'articles' | 'extraction';

/** The sections whose drafts the settings store keeps; `账号` owns its own fields. */
export type DraftSection = Exclude<SettingsSection, 'account'>;

/** The navigation items, in the order the page stacks the sections. */
export const settingsSections: ReadonlyArray<{
  readonly id: SettingsSection;
  readonly name: string;
}> = [
  { id: 'account', name: accountMessages.accountSectionHeading },
  { id: 'articles', name: copy.retentionHeading },
  { id: 'extraction', name: copy.fetcherHeading },
];

/** Whether a section differs from what was read. */
export type ChangeCheck = (section: SettingsSection) => boolean;

/** The id of a section's element: the stacked layout scrolls to it. */
export const sectionElementId = (section: SettingsSection): string =>
  `settings-${section}`;

export type SwitchOptions = {
  readonly open: SettingsSection;
  readonly target: SettingsSection;
  /** Beside the sections the navigation switches them; stacked it only scrolls. */
  readonly beside: boolean;
  readonly changed: ChangeCheck;
  readonly saving: boolean;
  readonly confirm: Confirm;
  readonly discard: (section: SettingsSection) => void;
};

export type SwitchResult = 'opened' | 'scrolled' | 'stayed';

/**
 * What pressing a navigation item does: beside the sections it opens the target,
 * asking first when the open section is changed and discarding that section's
 * drafts when the switch happens; stacked it only scrolls, so nothing typed is
 * discarded. A write in flight ignores the press (settings.md Interface).
 */
export const switchSection = (options: SwitchOptions): SwitchResult => {
  if (options.saving || options.target === options.open) return 'stayed';

  if (!options.beside) return 'scrolled';

  if (
    options.changed(options.open) &&
    !options.confirm(copy.sectionSwitchConfirmation)
  ) {
    return 'stayed';
  }

  options.discard(options.open);

  return 'opened';
};

export type SectionSwitchOptions = {
  readonly beside: () => boolean;
  readonly accountChanged: () => boolean;
  readonly draftChanged: (section: DraftSection) => boolean;
  readonly saving: () => boolean;
  readonly confirm: Confirm;
  readonly discard: (section: SettingsSection) => void;
  /** Brings a section into view in the stacked layout. */
  readonly scroll: (section: SettingsSection) => void;
};

/** The page's open section and the rule for switching it. */
export const createSectionSwitch = (options: SectionSwitchOptions) => {
  const [open, setOpen] = createSignal<SettingsSection>('account');

  const changed: ChangeCheck = (section) =>
    section === 'account'
      ? options.accountChanged()
      : options.draftChanged(section);

  const anyChanged = (): boolean =>
    changed('account') ||
    options.draftChanged('articles') ||
    options.draftChanged('extraction');

  const pick = (target: SettingsSection): void => {
    const result = switchSection({
      open: open(),
      target,
      beside: options.beside(),
      changed,
      saving: options.saving(),
      confirm: options.confirm,
      discard: options.discard,
    });

    if (result === 'stayed') return;

    setOpen(target);
    if (result === 'scrolled') options.scroll(target);
  };

  return { open, pick, changed, anyChanged };
};
