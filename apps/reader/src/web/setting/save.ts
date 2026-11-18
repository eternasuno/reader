import { messageOf } from '../api/messages';
import {
  removeJinaKey,
  setRetention,
  useBrowserFetcher,
  useJinaFetcher,
} from '../api/setting';
import { showToast } from '../ui/toast';
import type { Confirm } from './confirm';
import { given } from './drafts';
import { settingMessages as copy } from './messages';
import type { SavingAction, SettingStore } from './store';

/**
 * Runs one write, reports it as a toast and clears the write state, so nothing
 * else may start meanwhile (settings.md Saving and unsaved changes).
 */
const run = async (
  store: SettingStore,
  action: SavingAction,
  task: () => Promise<void>,
  applied: () => void,
  toast: string
): Promise<void> => {
  store.setSaving(action);

  try {
    await task();
    applied();
    showToast(toast);
  } catch (error) {
    showToast(messageOf(error), 'error');
  } finally {
    store.setSaving(undefined);
  }
};

/** Stores the retention (SET-FEED-1); the next refresh trims (SET-FEED-2). */
export const saveRetention = async (store: SettingStore): Promise<void> => {
  const stored = store.setting();
  if (stored === undefined || store.saving() !== undefined) return;

  const retention = Number(store.retentionDraft());
  const applied = (): void => {
    store.setSetting({ ...stored, retention });
    store.setRetentionDraft(String(retention));
  };

  await run(
    store,
    'retention',
    () => setRetention(retention),
    applied,
    copy.retentionSaved
  );
};

/**
 * Saves the selected provider in one request (SET-FETCH-1, SET-FETCH-2). Only
 * that provider changes: the other one's stored flag stays as it was and its
 * typed value stays in its field, because it was not sent (SET-FETCH-5).
 */
export const saveFetcher = async (store: SettingStore): Promise<void> => {
  const stored = store.setting();
  if (stored === undefined || store.saving() !== undefined) return;

  const provider = store.providerDraft();
  const key = given(store.jinaKeyDraft());
  const endpoint = given(store.endpointDraft());
  const applied = (): void => {
    store.setSetting(
      provider === 'browser'
        ? {
            ...stored,
            provider,
            browserEndpointConfigured:
              endpoint !== undefined || stored.browserEndpointConfigured,
          }
        : {
            ...stored,
            provider,
            jinaKeyConfigured: key !== undefined || stored.jinaKeyConfigured,
          }
    );
    if (provider === 'browser') store.setEndpointDraft('');
    else store.setJinaKeyDraft('');
  };

  await run(
    store,
    'fetcher',
    () =>
      provider === 'browser'
        ? useBrowserFetcher(endpoint)
        : useJinaFetcher(key),
    applied,
    copy.fetcherSaved
  );
};

/** Deletes the stored Jina key after its confirmation (SET-KEY-1); the provider stays. */
export const clearJinaKey = async (
  store: SettingStore,
  confirm: Confirm
): Promise<void> => {
  const stored = store.setting();
  if (stored === undefined || store.saving() !== undefined) return;
  if (!confirm(copy.clearKeyConfirmation)) return;

  const applied = (): void => {
    store.setSetting({ ...stored, jinaKeyConfigured: false });
  };

  await run(store, 'key', removeJinaKey, applied, copy.keyCleared);
};

/**
 * The password change runs inside `PasswordForm`, which keeps its pending state
 * to itself; the `账号` section reports it here so that one write at a time holds
 * for the whole page (settings.md).
 */
export const setAccountSaving = (store: SettingStore, busy: boolean): void => {
  store.setSaving((current) => {
    if (busy) return current ?? 'password';

    return current === 'password' ? undefined : current;
  });
};
