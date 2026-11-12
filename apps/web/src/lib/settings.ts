import { Schema } from 'effect';
import { createSend, decodeBody, sendGet } from './library-transport';

export type FetcherProvider = 'jina' | 'browser';

export type LibrarySettings = {
  readonly retention: number;
  readonly provider: FetcherProvider;
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
};

export type FetcherInput =
  | { readonly provider: 'jina'; readonly key?: string | undefined }
  | { readonly provider: 'browser'; readonly endpoint?: string | undefined };

const settingsPath = '/api/library/settings';

const send = createSend({});

const SettingsSchema = Schema.Struct({
  retention: Schema.Int,
  provider: Schema.Literals(['jina', 'browser']),
  jinaKeyConfigured: Schema.Boolean,
  browserEndpointConfigured: Schema.Boolean,
});

export const getSettings = async (): Promise<LibrarySettings> =>
  decodeBody(SettingsSchema, await sendGet(send, settingsPath));

export const saveRetention = async (retention: number): Promise<void> => {
  await send(`${settingsPath}/retention`, {
    method: 'PUT',
    body: { retention },
  });
};

const nonEmpty = (value: string | undefined): string | undefined => {
  const text = value?.trim() ?? '';

  return text === '' ? undefined : text;
};

type FetcherPayload = {
  readonly provider: FetcherProvider;
  readonly key?: string | undefined;
  readonly endpoint?: string | undefined;
};

const fetcherPayload = (input: FetcherInput): FetcherPayload => {
  if (input.provider === 'browser') {
    const endpoint = nonEmpty(input.endpoint);

    return endpoint === undefined
      ? { provider: 'browser' }
      : { provider: 'browser', endpoint };
  }

  const key = nonEmpty(input.key);

  return key === undefined ? { provider: 'jina' } : { provider: 'jina', key };
};

export const saveFetcher = async (input: FetcherInput): Promise<void> => {
  await send(`${settingsPath}/fetcher`, {
    method: 'PUT',
    body: fetcherPayload(input),
  });
};

export const clearJinaKey = async (): Promise<void> => {
  await send(`${settingsPath}/key`, { method: 'DELETE' });
};
