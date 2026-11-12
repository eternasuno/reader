import { Option, Schema } from 'effect';

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

const fallbackMessage = '操作失败，请稍后重试';

const messages: Record<string, string> = {
  Unauthorized: '登录状态已失效，请重新登录',
  Forbidden: '请求被拒绝，请刷新页面后重试',
  InvalidRetention: '保留数量必须是 30 到 300 之间的整数',
  InvalidProvider: '请选择有效的文章提取方式',
  InvalidKey: '请输入有效的 Jina API Key',
  InvalidEndpoint: '请输入有效的浏览器服务地址',
  BrowserEndpointRequired: '请填写浏览器服务地址',
  SettingRepositoryError: '暂时无法保存设置，请稍后重试',
  RequestFailed: '请求失败，请稍后重试',
  ServerError: '服务器暂时不可用，请稍后重试',
  InvalidResponse: '设置数据格式不正确，请稍后重试',
  NetworkError: '网络连接失败，请检查网络后重试',
};

const settingsErrorText = (code: string | undefined): string =>
  code === undefined ? fallbackMessage : (messages[code] ?? fallbackMessage);

const statusCode = (status: number): string => {
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status >= 500) return 'ServerError';

  return 'RequestFailed';
};

const readBody = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    throw new Error(settingsErrorText('NetworkError'));
  }
};

const errorCode = async (response: Response): Promise<string | undefined> => {
  let body: unknown;

  try {
    body = JSON.parse(await readBody(response));
  } catch {
    return undefined;
  }

  if (typeof body !== 'object' || body === null) {
    return undefined;
  }

  if ('_tag' in body && typeof body._tag === 'string') {
    return body._tag;
  }

  return undefined;
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await readBody(response);
  if (text === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(settingsErrorText('InvalidResponse'));
  }
};

type RequestOptions = {
  readonly method: string;
  readonly cache?: RequestCache;
  readonly payload?: unknown;
};

const request = async (
  path: string,
  options: RequestOptions
): Promise<unknown> => {
  const { payload } = options;
  let response: Response;

  try {
    response = await fetch(path, {
      method: options.method,
      credentials: 'include',
      ...(options.cache === undefined ? {} : { cache: options.cache }),
      ...(payload === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
    });
  } catch {
    throw new Error(settingsErrorText('NetworkError'));
  }

  if (!response.ok) {
    const code = (await errorCode(response)) ?? statusCode(response.status);

    throw new Error(settingsErrorText(code));
  }

  return readJson(response);
};

const SettingsSchema = Schema.Struct({
  retention: Schema.Int,
  provider: Schema.Literals(['jina', 'browser']),
  jinaKeyConfigured: Schema.Boolean,
  browserEndpointConfigured: Schema.Boolean,
});

const parseSettings = (value: unknown): LibrarySettings | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(SettingsSchema)(value));

export const getSettings = async (): Promise<LibrarySettings> => {
  const body = await request(settingsPath, {
    method: 'GET',
    cache: 'no-store',
  });
  const settings = parseSettings(body);
  if (settings === undefined) {
    throw new Error(settingsErrorText('InvalidResponse'));
  }

  return settings;
};

export const saveRetention = async (retention: number): Promise<void> => {
  await request(`${settingsPath}/retention`, {
    method: 'PUT',
    payload: { retention },
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
  await request(`${settingsPath}/fetcher`, {
    method: 'PUT',
    payload: fetcherPayload(input),
  });
};

export const clearJinaKey = async (): Promise<void> => {
  await request(`${settingsPath}/key`, { method: 'DELETE' });
};
