import { makeRunner } from './client';

export type FetcherProvider = 'jina' | 'browser';

export type LibrarySettings = {
  readonly retention: number;
  readonly provider: FetcherProvider;
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
};

const run = makeRunner({});

export const getSettings = async (): Promise<LibrarySettings> =>
  run((client) => client.library.settings());

export const saveRetention = async (retention: number): Promise<void> => {
  await run((client) =>
    client.library.setRetention({ payload: { retention } })
  );
};

const nonEmpty = (value: string | undefined): string | undefined => {
  const text = value?.trim() ?? '';

  return text === '' ? undefined : text;
};

export const useJinaFetcher = async (key?: string): Promise<void> => {
  const given = nonEmpty(key);
  await run((client) =>
    client.library.useJinaFetcher({
      payload: given === undefined ? {} : { key: given },
    })
  );
};

export const useBrowserFetcher = async (endpoint?: string): Promise<void> => {
  const given = nonEmpty(endpoint);
  await run((client) =>
    client.library.useBrowserFetcher({
      payload: given === undefined ? {} : { endpoint: given },
    })
  );
};

export const clearJinaKey = async (): Promise<void> => {
  await run((client) => client.library.deleteKey());
};
