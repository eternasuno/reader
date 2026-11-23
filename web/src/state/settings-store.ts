/**
 * Shared settings store (`SET-VAL-*`, `SET-SVC-1`, `SET-KINDLE-1`, `KD-SEND-1`): loaded
 * settings, mounted page drafts, and the save/send guards. Draft signals live inside a mounted
 * `SettingsPage` scope so secret drafts never persist in module state after leaving settings.
 */

import {
  type Accessor,
  createRoot,
  createSignal,
  flush,
  type Setter,
  untrack,
} from 'solid-js';
import type {
  ExtractorProvider,
  KindleSendRecord,
  Settings,
  SMTPSecurity,
} from '../api';
import { errorCodeOf } from '../api';
import { translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import { onSessionCleared } from './session';

export type SettingsSection = 'articles' | 'extraction' | 'kindle' | 'services';

/** `SET-VAL-1`: retention defaults to 100. */
export const DEFAULT_RETENTION = 100;

const [settings, setSettings] = createSignal<Settings | null>(null);
const [loadingSettings, setLoadingSettings] = createSignal(false);

const [savingAction, setSavingAction] = createSignal<string | null>(null);
const [kindleSending, setKindleSending] = createSignal(false);
const [kindleSends, setKindleSends] = createSignal<
  ReadonlyArray<KindleSendRecord>
>([]);
const [kindleRunning, setKindleRunning] = createSignal(false);

interface SettingsDrafts {
  retention: Accessor<number>;
  setRetention: Setter<number>;
  provider: Accessor<ExtractorProvider>;
  setProvider: Setter<ExtractorProvider>;
  jinaKey: Accessor<string>;
  setJinaKey: Setter<string>;
  browserEndpoint: Accessor<string>;
  setBrowserEndpoint: Setter<string>;
  smtpSenderEmail: Accessor<string>;
  setSmtpSenderEmail: Setter<string>;
  smtpHost: Accessor<string>;
  setSmtpHost: Setter<string>;
  smtpPort: Accessor<number>;
  setSmtpPort: Setter<number>;
  smtpSecurity: Accessor<SMTPSecurity>;
  setSmtpSecurity: Setter<SMTPSecurity>;
  smtpUser: Accessor<string>;
  setSmtpUser: Setter<string>;
  smtpPassword: Accessor<string>;
  setSmtpPassword: Setter<string>;
  kindleEmail: Accessor<string>;
  setKindleEmail: Setter<string>;
  sendTime: Accessor<string>;
  setSendTime: Setter<string>;
  dispose: () => void;
}

let activeDrafts: SettingsDrafts | null = null;

const createCoreDrafts = (initial: Settings | null) => {
  const [retention, setRetention] = createSignal(
    initial?.retention ?? DEFAULT_RETENTION
  );
  const [provider, setProvider] = createSignal<ExtractorProvider>(
    initial?.provider ?? 'direct'
  );
  // `SET-VAL-3`: secrets are never returned, so drafts always start blank.
  const [jinaKey, setJinaKey] = createSignal('');
  const [browserEndpoint, setBrowserEndpoint] = createSignal('');
  const [kindleEmail, setKindleEmail] = createSignal(
    initial?.kindle?.kindleEmail ?? ''
  );
  const [sendTime, setSendTime] = createSignal(initial?.kindle?.sendTime ?? '');

  return {
    retention,
    setRetention,
    provider,
    setProvider,
    jinaKey,
    setJinaKey,
    browserEndpoint,
    setBrowserEndpoint,
    kindleEmail,
    setKindleEmail,
    sendTime,
    setSendTime,
  };
};

const createSmtpDrafts = (smtp: Settings['smtp'] | undefined) => {
  const [smtpSenderEmail, setSmtpSenderEmail] = createSignal(
    smtp?.senderEmail ?? ''
  );
  const [smtpHost, setSmtpHost] = createSignal(smtp?.host ?? '');
  const [smtpPort, setSmtpPort] = createSignal(smtp?.port ?? 0);
  const [smtpSecurity, setSmtpSecurity] = createSignal<SMTPSecurity>(
    smtp?.security ?? 'tls'
  );
  const [smtpUser, setSmtpUser] = createSignal(smtp?.user ?? '');
  const [smtpPassword, setSmtpPassword] = createSignal('');

  return {
    smtpSenderEmail,
    setSmtpSenderEmail,
    smtpHost,
    setSmtpHost,
    smtpPort,
    setSmtpPort,
    smtpSecurity,
    setSmtpSecurity,
    smtpUser,
    setSmtpUser,
    smtpPassword,
    setSmtpPassword,
  };
};

const createSettingsDrafts = (initial: Settings | null): SettingsDrafts =>
  createRoot((disposeRoot) => {
    const core = createCoreDrafts(initial);
    const smtp = createSmtpDrafts(initial?.smtp);

    return {
      ...core,
      ...smtp,
      dispose: disposeRoot,
    };
  });

/**
 * Creates a draft scope owned by the mounted settings page and returns its disposer.
 * Leaving settings disposes the scope so secret drafts do not persist in memory.
 */
export const mountSettingsDrafts = (): (() => void) => {
  activeDrafts?.dispose();
  const drafts = createSettingsDrafts(untrack(settings));
  activeDrafts = drafts;

  return () => {
    if (activeDrafts === drafts) {
      activeDrafts = null;
    }
    drafts.dispose();
  };
};

export type DraftsOwner = SettingsDrafts | null;

export const currentDraftsOwner = (): DraftsOwner => activeDrafts;

export const isCurrentDraftsOwner = (owner: DraftsOwner): boolean =>
  activeDrafts === owner;

const readDraft = <T>(
  pick: (drafts: SettingsDrafts) => Accessor<T>,
  fallback: T
): T => (activeDrafts === null ? fallback : pick(activeDrafts)());

const writeDraft = <T>(
  pick: (drafts: SettingsDrafts) => Setter<T>,
  value: T
): void => {
  if (activeDrafts !== null) pick(activeDrafts)(() => value);
};

export const retentionDraft = (): number =>
  readDraft((d) => d.retention, DEFAULT_RETENTION);
export const setRetentionDraft = (value: number): void =>
  writeDraft((d) => d.setRetention, value);

export const providerDraft = (): ExtractorProvider =>
  readDraft((d) => d.provider, 'direct');
export const setProviderDraft = (value: ExtractorProvider): void =>
  writeDraft((d) => d.setProvider, value);

export const jinaKeyDraft = (): string => readDraft((d) => d.jinaKey, '');
export const setJinaKeyDraft = (value: string): void =>
  writeDraft((d) => d.setJinaKey, value);

export const browserEndpointDraft = (): string =>
  readDraft((d) => d.browserEndpoint, '');
export const setBrowserEndpointDraft = (value: string): void =>
  writeDraft((d) => d.setBrowserEndpoint, value);

export const smtpSenderEmailDraft = (): string =>
  readDraft((d) => d.smtpSenderEmail, '');
export const setSmtpSenderEmailDraft = (value: string): void =>
  writeDraft((d) => d.setSmtpSenderEmail, value);

export const smtpHostDraft = (): string => readDraft((d) => d.smtpHost, '');
export const setSmtpHostDraft = (value: string): void =>
  writeDraft((d) => d.setSmtpHost, value);

export const smtpPortDraft = (): number => readDraft((d) => d.smtpPort, 0);
export const setSmtpPortDraft = (value: number): void =>
  writeDraft((d) => d.setSmtpPort, value);

export const smtpSecurityDraft = (): SMTPSecurity =>
  readDraft((d) => d.smtpSecurity, 'tls');
export const setSmtpSecurityDraft = (value: SMTPSecurity): void =>
  writeDraft((d) => d.setSmtpSecurity, value);

export const smtpUserDraft = (): string => readDraft((d) => d.smtpUser, '');
export const setSmtpUserDraft = (value: string): void =>
  writeDraft((d) => d.setSmtpUser, value);

export const smtpPasswordDraft = (): string =>
  readDraft((d) => d.smtpPassword, '');
export const setSmtpPasswordDraft = (value: string): void =>
  writeDraft((d) => d.setSmtpPassword, value);

export const kindleEmailDraft = (): string =>
  readDraft((d) => d.kindleEmail, '');
export const setKindleEmailDraft = (value: string): void =>
  writeDraft((d) => d.setKindleEmail, value);

export const sendTimeDraft = (): string => readDraft((d) => d.sendTime, '');
export const setSendTimeDraft = (value: string): void =>
  writeDraft((d) => d.setSendTime, value);

export {
  kindleRunning,
  kindleSending,
  kindleSends,
  loadingSettings,
  savingAction,
  setKindleRunning,
  setKindleSending,
  setKindleSends,
  setLoadingSettings,
  setSettings,
  settings,
};

let saveToken = 0;
let activeSaveToken: number | null = null;
let kindleSendsGeneration = 0;

export const nextKindleSendsGeneration = (): number => {
  kindleSendsGeneration += 1;
  return kindleSendsGeneration;
};

export const isCurrentKindleSendsGeneration = (generation: number): boolean =>
  kindleSendsGeneration === generation;

export const clearSettingsState = (): void => {
  const drafts = activeDrafts;
  activeDrafts = null;
  drafts?.dispose();
  activeSaveToken = null;
  kindleSendsGeneration += 1;
  setSettings(null);
  setLoadingSettings(false);
  setSavingAction(null);
  setKindleSending(false);
  setKindleSends([]);
  setKindleRunning(false);
};

onSessionCleared(clearSettingsState);

export const toastSettingsError = (error: unknown): false => {
  showToast(translateErrorCode(errorCodeOf(error)), 'error');
  return false;
};

export const optionalText = (value: string): string | undefined =>
  value.trim().length > 0 ? value.trim() : undefined;

/** `settings.md:25`: only one save runs at a time; the guard never blocks Kindle sends. */
export const runSave = async (
  action: string,
  work: () => Promise<boolean>
): Promise<boolean> => {
  if (savingAction() !== null) return false;

  saveToken += 1;
  const ownerToken = saveToken;
  activeSaveToken = ownerToken;
  setSavingAction(action);
  flush();
  try {
    return await work();
  } finally {
    if (activeSaveToken === ownerToken) {
      activeSaveToken = null;
      setSavingAction(null);
      flush();
    }
  }
};
