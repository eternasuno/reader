import {
  decodeWith,
  isKindleSendRecord,
  isKindleSends,
  isSettings,
} from './decoders';
import { item, request, requestNoContent } from './request';
import type {
  BrowserlessSettingsInput,
  KindleSendRecord,
  KindleSends,
  KindleSettings,
  RequestCallOptions,
  Settings,
  SmtpSettingsInput,
} from './types';

export const settingsApi = {
  get: (options?: RequestCallOptions): Promise<Settings> =>
    request('/api/settings', decodeWith(isSettings), options),
  updateRetention: (
    retention: number,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent('/api/settings/retention', {
      ...options,
      method: 'PUT',
      body: { retention },
    }),
  saveBrowserless: (
    input: BrowserlessSettingsInput,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent('/api/settings/services/browserless', {
      ...options,
      method: 'PUT',
      body: input,
    }),
  deleteBrowserless: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/settings/services/browserless', {
      ...options,
      method: 'DELETE',
    }),
  deleteBrowserlessToken: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/settings/services/browserless/token', {
      ...options,
      method: 'DELETE',
    }),
  saveSmtp: (
    input: SmtpSettingsInput,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent('/api/settings/services/smtp', {
      ...options,
      method: 'PUT',
      body: input,
    }),
  deleteSmtp: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/settings/services/smtp', {
      ...options,
      method: 'DELETE',
    }),
  deleteSmtpPassword: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/settings/services/smtp/password', {
      ...options,
      method: 'DELETE',
    }),
  updateKindle: (
    input: KindleSettings,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent('/api/settings/kindle', {
      ...options,
      method: 'PUT',
      body: input,
    }),
};

export const kindleApi = {
  sendNow: (options?: RequestCallOptions): Promise<KindleSendRecord> =>
    item('/api/kindle/send', isKindleSendRecord, {
      ...options,
      method: 'POST',
    }),
  listSends: (options?: RequestCallOptions): Promise<KindleSends> =>
    request('/api/kindle/sends', decodeWith(isKindleSends), options),
};
