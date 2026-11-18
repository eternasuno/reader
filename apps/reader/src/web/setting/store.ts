import { type Accessor, createSignal, type Setter } from 'solid-js';
import { messageOf } from '../api/messages';
import { getSetting, type Setting } from '../api/setting';
import {
  applyRead,
  changedDraft,
  createDrafts,
  type Drafts,
  discardDraft,
} from './drafts';
import type { DraftSection, SettingsSection } from './section';

export type { Setting } from '../api/setting';

/** The write in flight; one runs at a time per page (settings.md). */
export type SavingAction = 'retention' | 'fetcher' | 'key' | 'password';

/**
 * The settings page's state: what was read, the drafts of `文章` and `提取`, whether
 * `账号` holds text, and the one write in flight. The writes themselves are
 * `save.ts`; the `账号` section's fields belong to `PasswordForm` and only its
 * changed flag and its write are reported here (settings.md).
 */
export type SettingStore = Drafts & {
  readonly setting: Accessor<Setting | undefined>;
  readonly setSetting: Setter<Setting | undefined>;
  readonly readError: Accessor<string>;
  readonly setReadError: Setter<string>;
  /** Any of the `账号` section's three password fields holds text. */
  readonly accountChanged: Accessor<boolean>;
  readonly setAccountChanged: Setter<boolean>;
  readonly saving: Accessor<SavingAction | undefined>;
  readonly setSaving: Setter<SavingAction | undefined>;
};

export const createSettingStore = (): SettingStore => {
  const [setting, setSetting] = createSignal<Setting>();
  const [readError, setReadError] = createSignal('');
  const [accountChanged, setAccountChanged] = createSignal(false);
  const [saving, setSaving] = createSignal<SavingAction>();

  return {
    ...createDrafts(),
    setting,
    setSetting,
    readError,
    setReadError,
    accountChanged,
    setAccountChanged,
    saving,
    setSaving,
  };
};

/** The reading label shows until a read answers one way or the other. */
export const reading = (store: SettingStore): boolean =>
  store.setting() === undefined && store.readError() === '';

/**
 * Reads the settings; the retry button reads them again (settings.md Interface).
 * A read starts the page afresh: every draft is discarded, the changed flag of
 * `账号` with it, and no write is in flight any more (`settingStore` outlives the
 * page, so a write left behind by a redirect to `/login` would otherwise lock it).
 */
export const loadSetting = async (store: SettingStore): Promise<void> => {
  store.setSetting(undefined);
  store.setReadError('');
  store.setAccountChanged(false);
  store.setSaving(undefined);

  try {
    const stored = await getSetting();

    store.setSetting(stored);
    applyRead(store, stored);
  } catch (error) {
    store.setReadError(messageOf(error));
  }
};

/** Whether a section differs from what was read. */
export const draftChanged = (
  store: SettingStore,
  section: DraftSection
): boolean => {
  const stored = store.setting();

  return stored !== undefined && changedDraft(store, stored, section);
};

/** Drops a section's drafts after a confirmed switch (settings.md Interface). */
export const discard = (
  store: SettingStore,
  section: SettingsSection
): void => {
  const stored = store.setting();

  if (stored !== undefined) discardDraft(store, stored, section);
};

/** The page's one store. */
export const settingStore = createSettingStore();
