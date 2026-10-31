export type ReaderProvider = 'jina' | 'browser';

export type LibrarySettings = {
  readonly retention: number;
  readonly provider: ReaderProvider;
  readonly jinaConfigured: boolean;
  readonly browserEndpoint: string;
};

export type ExtractionUpdate = {
  readonly provider: ReaderProvider;
  readonly jinaKey?: string;
  readonly browserEndpoint?: string;
};

const settingsPath = '/api/library/settings';
const fallbackMessage = '操作失败，请稍后重试';

const messages: Record<string, string> = {
  Unauthorized: '登录状态已失效，请重新登录',
  Forbidden: '请求被拒绝，请刷新页面后重试',
  InvalidRetention: '保留数量必须是 30 到 300 之间的整数',
  InvalidProvider: '请选择有效的文章提取方式',
  InvalidKey: '请输入有效的 Jina API Key',
  InvalidEndpoint: '请输入有效的浏览器服务地址',
  SettingsReadError: '暂时无法读取设置，请稍后重试',
  SettingsSaveError: '暂时无法保存设置，请稍后重试',
  SubscriptionReadError: '暂时无法读取设置，请稍后重试',
  SubscriptionWriteError: '暂时无法保存设置，请稍后重试',
  ExtractionSettingsReadError: '暂时无法读取提取设置，请稍后重试',
  ExtractionSettingsWriteError: '暂时无法保存提取设置，请稍后重试',
  NotFound: '要修改的设置不存在，请刷新页面后重试',
  Conflict: '设置已在别处修改，请刷新页面后重试',
  RequestFailed: '请求失败，请稍后重试',
  ServerError: '服务器暂时不可用，请稍后重试',
  InvalidResponse: '设置数据格式不正确，请稍后重试',
  NetworkError: '网络连接失败，请检查网络后重试',
};

export const settingsErrorText = (code: string | undefined): string =>
  code === undefined ? fallbackMessage : (messages[code] ?? fallbackMessage);

const statusCode = (status: number): string => {
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 404) return 'NotFound';
  if (status === 409) return 'Conflict';
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

  if ('code' in body && typeof body.code === 'string') {
    return body.code;
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

const parseProvider = (value: unknown): ReaderProvider | undefined =>
  value === 'jina' || value === 'browser' ? value : undefined;

const parseSettings = (value: unknown): LibrarySettings | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const provider =
    'provider' in value ? parseProvider(value.provider) : undefined;
  if (
    !('retention' in value) ||
    typeof value.retention !== 'number' ||
    !Number.isInteger(value.retention) ||
    provider === undefined ||
    !('jinaConfigured' in value) ||
    typeof value.jinaConfigured !== 'boolean' ||
    !('browserEndpoint' in value) ||
    typeof value.browserEndpoint !== 'string'
  ) {
    return undefined;
  }

  return {
    retention: value.retention,
    provider,
    jinaConfigured: value.jinaConfigured,
    browserEndpoint: value.browserEndpoint,
  };
};

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

export const saveExtraction = async (
  update: ExtractionUpdate
): Promise<void> => {
  const jinaKey = update.jinaKey?.trim() ?? '';
  const browserEndpoint = update.browserEndpoint?.trim() ?? '';

  await request(`${settingsPath}/extraction`, {
    method: 'PUT',
    payload: {
      provider: update.provider,
      ...(jinaKey === '' ? {} : { jinaKey }),
      ...(browserEndpoint === '' ? {} : { browserEndpoint }),
    },
  });
};

export const clearJinaKey = async (): Promise<void> => {
  await request(`${settingsPath}/key`, { method: 'DELETE' });
};

export const clearBrowserEndpoint = async (): Promise<void> => {
  await request(`${settingsPath}/browser`, { method: 'DELETE' });
};
