import {
  decodeWith,
  isKindleSendRecord,
  isKindleSends,
  isSettings,
} from './decoders';
import { item, request, requestNoContent } from './request';
import type {
  ExtractorProvider,
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
  updateProvider: (
    provider: ExtractorProvider,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent('/api/settings/provider', {
      ...options,
      method: 'PUT',
      body: { provider },
    }),
  saveJinaKey: (key: string, options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/settings/services/jina', {
      ...options,
      method: 'PUT',
      body: { key },
    }),
  deleteJinaKey: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/settings/services/jina', {
      ...options,
      method: 'DELETE',
    }),
  saveBrowserEndpoint: (
    endpoint: string,
    options?: RequestCallOptions
  ): Promise<void> =>
    requestNoContent('/api/settings/services/browser', {
      ...options,
      method: 'PUT',
      body: { endpoint },
    }),
  deleteBrowserEndpoint: (options?: RequestCallOptions): Promise<void> =>
    requestNoContent('/api/settings/services/browser', {
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
