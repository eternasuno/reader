import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearJinaKey,
  getSettings,
  saveFetcher,
  saveRetention,
} from '../../src/lib/settings';

const fetchMock = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const settings = {
  retention: 120,
  provider: 'jina',
  jinaKeyConfigured: true,
  browserEndpointConfigured: false,
};

const lastCall = (): [string, RequestInit | undefined] => {
  const call = fetchMock.mock.calls.at(-1);

  return [String(call?.[0]), call?.[1] as RequestInit | undefined];
};

const lastBody = (): unknown => JSON.parse(String(lastCall()[1]?.body));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('getSettings', () => {
  it('loads the settings flags', async () => {
    fetchMock.mockResolvedValue(json(settings));

    await expect(getSettings()).resolves.toEqual(settings);
    const [path, init] = lastCall();
    expect(path).toBe('/api/library/settings');
    expect(init?.method).toBe('GET');
  });

  it('accepts a browser endpoint that is only reported as configured', async () => {
    const browser = {
      retention: 120,
      provider: 'browser',
      jinaKeyConfigured: false,
      browserEndpointConfigured: true,
    };
    fetchMock.mockResolvedValue(json(browser));

    await expect(getSettings()).resolves.toEqual(browser);
  });
});

describe('settings payload validation', () => {
  it('rejects malformed settings payloads', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...settings, retention: '120' }));
    await expect(getSettings()).rejects.toThrow(
      '响应数据格式不正确，请稍后重试'
    );

    fetchMock.mockResolvedValueOnce(
      json({
        retention: 120,
        provider: 'jina',
        jinaConfigured: true,
        browserEndpointConfigured: false,
      })
    );
    await expect(getSettings()).rejects.toThrow(
      '响应数据格式不正确，请稍后重试'
    );

    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(getSettings()).rejects.toThrow(
      '响应数据格式不正确，请稍后重试'
    );
  });
});

describe('settings errors', () => {
  it('maps error tags to Chinese messages without backend text', async () => {
    fetchMock.mockResolvedValue(
      json({ _tag: 'InvalidRetention', message: 'backend text' }, 400)
    );

    await expect(saveRetention(0)).rejects.toThrow('保留数量必须是正整数');
  });

  it('localizes the required browser endpoint', async () => {
    fetchMock.mockResolvedValue(
      json({ _tag: 'BrowserEndpointRequired', message: 'required' }, 422)
    );

    await expect(saveFetcher({ provider: 'browser' })).rejects.toThrow(
      '请填写浏览器服务地址'
    );
  });

  it('localizes the remaining fetcher and setting failures', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['InvalidProvider', '请选择有效的文章提取方式'],
      ['InvalidKey', '请输入有效的 Jina API Key'],
      ['InvalidEndpoint', '请输入有效的浏览器服务地址'],
      ['SettingRepositoryError', '暂时无法访问设置，请稍后重试'],
    ];

    for (const [tag, message] of cases) {
      fetchMock.mockResolvedValueOnce(json({ _tag: tag }, 400));
      await expect(saveFetcher({ provider: 'jina' })).rejects.toThrow(message);
    }
  });
});

describe('settings mutations', () => {
  it('sends the retention payload as JSON', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await saveRetention(120);
    const [path, init] = lastCall();
    expect(path).toBe('/api/library/settings/retention');
    expect(init?.method).toBe('PUT');
    expect(lastBody()).toEqual({ retention: 120 });
  });

  it('omits a blank Jina key', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await saveFetcher({ provider: 'jina', key: '  ' });

    expect(lastCall()[0]).toBe('/api/library/settings/fetcher');
    expect(lastCall()[1]?.method).toBe('PUT');
    expect(lastBody()).toEqual({ provider: 'jina' });
  });

  it('sends a trimmed Jina key', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await saveFetcher({ provider: 'jina', key: ' key ' });

    expect(lastBody()).toEqual({ provider: 'jina', key: 'key' });
  });

  it('omits a blank browser endpoint', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await saveFetcher({ provider: 'browser', endpoint: ' ' });

    expect(lastBody()).toEqual({ provider: 'browser' });
  });

  it('sends a trimmed browser endpoint', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await saveFetcher({
      provider: 'browser',
      endpoint: ' ws://127.0.0.1:9222 ',
    });

    expect(lastBody()).toEqual({
      provider: 'browser',
      endpoint: 'ws://127.0.0.1:9222',
    });
  });

  it('deletes the saved key', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await clearJinaKey();
    expect(lastCall()[0]).toBe('/api/library/settings/key');
    expect(lastCall()[1]?.method).toBe('DELETE');
  });
});
