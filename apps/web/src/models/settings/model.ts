import { createSignal, onCleanup, onMount } from 'solid-js';
import { changePassword } from '../../api/auth';
import { libraryErrorMessage } from '../../api/errors';
import {
  clearJinaKey,
  type FetcherProvider,
  getSettings,
  type LibrarySettings,
  saveRetention,
  useBrowserFetcher,
  useJinaFetcher,
} from '../../api/settings';

export type SettingsSection = 'account' | 'articles' | 'extraction';

export type SettingsToast = {
  readonly kind: 'success' | 'error';
  readonly message: string;
};

type PendingAction = 'password' | 'retention' | 'extraction' | 'key';

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : libraryErrorMessage(error);

const createDraftStore = () => {
  const [settings, setSettings] = createSignal<LibrarySettings>();
  const [retention, setRetention] = createSignal('');
  const [provider, setProvider] = createSignal<FetcherProvider>('jina');
  const [jinaKey, setJinaKey] = createSignal('');
  const [browserEndpoint, setBrowserEndpoint] = createSignal('');
  const [currentPassword, setCurrentPassword] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');

  return {
    settings,
    setSettings,
    retention,
    setRetention,
    provider,
    setProvider,
    jinaKey,
    setJinaKey,
    browserEndpoint,
    setBrowserEndpoint,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
  };
};

export type DraftStore = ReturnType<typeof createDraftStore>;

const createStatusStore = () => {
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal('');
  const [pending, setPending] = createSignal<PendingAction>();
  const [toast, setToast] = createSignal<SettingsToast>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = (kind: SettingsToast['kind'], message: string) => {
    if (timer !== undefined) clearTimeout(timer);

    setToast({ kind, message });
    timer = setTimeout(() => {
      timer = undefined;
      setToast(undefined);
    }, 4000);
  };
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  return {
    loading,
    setLoading,
    loadError,
    setLoadError,
    pending,
    setPending,
    toast,
    setToast,
    notify,
  };
};

export type StatusStore = ReturnType<typeof createStatusStore>;

export const isSettingsBusy = (status: StatusStore) =>
  status.pending() !== undefined;

const runAction = async (
  status: StatusStore,
  action: PendingAction,
  task: () => Promise<void>,
  success: string
) => {
  if (isSettingsBusy(status)) return;

  status.setPending(action);

  try {
    await task();
    status.notify('success', success);
  } catch (error) {
    status.notify('error', failureMessage(error));
  } finally {
    status.setPending(undefined);
  }
};

const confirmAction = (
  drafts: DraftStore,
  status: StatusStore,
  prompt: string,
  action: PendingAction,
  task: (base: LibrarySettings) => Promise<void>,
  success: string
) => {
  const base = drafts.settings();
  if (base === undefined || isSettingsBusy(status)) return;

  if (!window.confirm(prompt)) return;

  void runAction(status, action, () => task(base), success);
};

const applySettings = (drafts: DraftStore, data: LibrarySettings) => {
  drafts.setSettings(data);
  drafts.setRetention(String(data.retention));
  drafts.setProvider(data.provider);
  drafts.setBrowserEndpoint('');
  drafts.setJinaKey('');
};

const loadSettings = async (drafts: DraftStore, status: StatusStore) => {
  status.setLoading(true);
  status.setLoadError('');

  try {
    applySettings(drafts, await getSettings());
  } catch (error) {
    status.setLoadError(failureMessage(error));
  } finally {
    status.setLoading(false);
  }
};

const accountDirty = (drafts: DraftStore) =>
  drafts.currentPassword() !== '' ||
  drafts.newPassword() !== '' ||
  drafts.confirmPassword() !== '';

const articlesDirty = (drafts: DraftStore) => {
  const base = drafts.settings();

  return base !== undefined && drafts.retention() !== String(base.retention);
};

const extractionDirty = (drafts: DraftStore) => {
  const base = drafts.settings();
  if (base === undefined) return false;

  return (
    drafts.provider() !== base.provider ||
    drafts.jinaKey().trim() !== '' ||
    drafts.browserEndpoint().trim() !== ''
  );
};

const resetAccount = (drafts: DraftStore) => {
  drafts.setCurrentPassword('');
  drafts.setNewPassword('');
  drafts.setConfirmPassword('');
};

const resetArticles = (drafts: DraftStore) => {
  const base = drafts.settings();
  if (base !== undefined) drafts.setRetention(String(base.retention));
};

const resetExtraction = (drafts: DraftStore) => {
  const base = drafts.settings();
  if (base === undefined) return;

  drafts.setProvider(base.provider);
  drafts.setBrowserEndpoint('');
  drafts.setJinaKey('');
};

export const isSectionDirty = (
  drafts: DraftStore,
  section: SettingsSection
) => {
  if (section === 'account') return accountDirty(drafts);

  if (section === 'articles') return articlesDirty(drafts);

  return extractionDirty(drafts);
};

export const anySettingsDirty = (drafts: DraftStore) =>
  accountDirty(drafts) || articlesDirty(drafts) || extractionDirty(drafts);

export const resetSettingsSection = (
  drafts: DraftStore,
  section: SettingsSection
) => {
  if (section === 'account') resetAccount(drafts);
  else if (section === 'articles') resetArticles(drafts);
  else resetExtraction(drafts);
};

type SubmitForm = (
  drafts: DraftStore,
  status: StatusStore,
  form: HTMLFormElement
) => void;

export const submitPassword: SubmitForm = (drafts, status, form) => {
  form.classList.add('submitted');
  if (isSettingsBusy(status) || !form.checkValidity()) return;

  const params = {
    currentPassword: drafts.currentPassword(),
    newPassword: drafts.newPassword(),
  };
  void runAction(
    status,
    'password',
    async () => {
      await changePassword(params);
      resetAccount(drafts);
    },
    '密码已更新，其他设备已退出登录'
  );
};

export const submitRetention: SubmitForm = (drafts, status, form) => {
  const base = drafts.settings();
  form.classList.add('submitted');
  if (base === undefined || isSettingsBusy(status)) return;

  if (!form.checkValidity()) return;

  const value = Number(drafts.retention());

  if (!Number.isInteger(value)) return;

  void runAction(
    status,
    'retention',
    async () => {
      await saveRetention(value);
      drafts.setSettings({ ...base, retention: value });
      drafts.setRetention(String(value));
    },
    '文章保留数量已保存'
  );
};

const applyFetcherSaved = (
  drafts: DraftStore,
  base: LibrarySettings,
  provider: FetcherProvider,
  key: string,
  endpoint: string
) => {
  if (provider === 'browser') {
    drafts.setSettings({
      ...base,
      provider,
      browserEndpointConfigured:
        base.browserEndpointConfigured || endpoint.trim() !== '',
    });
    drafts.setBrowserEndpoint('');

    return;
  }

  drafts.setSettings({
    ...base,
    provider,
    jinaKeyConfigured: base.jinaKeyConfigured || key.trim() !== '',
  });
  drafts.setJinaKey('');
};

export const submitFetcher: SubmitForm = (drafts, status, form) => {
  const base = drafts.settings();
  form.classList.add('submitted');
  if (base === undefined || isSettingsBusy(status)) return;

  if (!form.checkValidity()) return;

  const provider = drafts.provider();
  const key = drafts.jinaKey();
  const endpoint = drafts.browserEndpoint();

  void runAction(
    status,
    'extraction',
    async () => {
      await (provider === 'browser'
        ? useBrowserFetcher(endpoint)
        : useJinaFetcher(key));
      applyFetcherSaved(drafts, base, provider, key, endpoint);
    },
    '提取设置已保存'
  );
};

export const removeJinaKey = (drafts: DraftStore, status: StatusStore) =>
  confirmAction(
    drafts,
    status,
    '删除已保存的 Jina Key？删除后 Jina 提取将使用匿名访问。',
    'key',
    async (base) => {
      await clearJinaKey();
      drafts.setSettings({ ...base, jinaKeyConfigured: false });
    },
    'Jina Key 已删除'
  );

export const createSettingsStores = () => ({
  drafts: createDraftStore(),
  status: createStatusStore(),
});

export const useSettingsModel = () => {
  const { drafts, status } = createSettingsStores();
  onMount(() => {
    void loadSettings(drafts, status);
  });

  return {
    drafts,
    status,
    reload: () => {
      void loadSettings(drafts, status);
    },
  };
};
