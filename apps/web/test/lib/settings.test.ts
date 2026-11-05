import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBrowserEndpoint,
  clearJinaKey,
  getSettings,
  saveExtraction,
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
  jinaConfigured: true,
  browserEndpoint: 'ws://127.0.0.1:9222',
};

const lastCall = (): [string, RequestInit | undefined] => {
  const call = fetchMock.mock.calls.at(-1);

  return [String(call?.[0]), call?.[1] as RequestInit | undefined];
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('getSettings', () => {
  it('loads the direct settings shape with credentials', async () => {
    fetchMock.mockResolvedValue(json(settings));

    await expect(getSettings()).resolves.toEqual(settings);
    const [path, init] = lastCall();
    expect(path).toBe('/api/library/settings');
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
  });

  it('accepts settings without a saved browser endpoint', async () => {
    const withoutEndpoint = {
      retention: 120,
      provider: 'jina',
      jinaConfigured: true,
    };
    fetchMock.mockResolvedValue(json(withoutEndpoint));

    await expect(getSettings()).resolves.toEqual(withoutEndpoint);
  });

  it('rejects malformed settings payloads', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...settings, retention: '120' }));
    await expect(getSettings()).rejects.toThrow(
      '设置数据格式不正确，请稍后重试'
    );

    fetchMock.mockResolvedValueOnce(
      json({ ...settings, browserEndpoint: 9222 })
    );
    await expect(getSettings()).rejects.toThrow(
      '设置数据格式不正确，请稍后重试'
    );

    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(getSettings()).rejects.toThrow(
      '设置数据格式不正确，请稍后重试'
    );
  });
});

describe('settings errors', () => {
  it('maps error tags to Chinese messages without backend text', async () => {
    fetchMock.mockResolvedValue(
      json({ _tag: 'InvalidRetention', message: 'backend text' }, 400)
    );

    await expect(saveRetention(10)).rejects.toThrow(
      '保留数量必须是 30 到 300 之间的整数'
    );
  });

  it('maps status codes when the body has no error code', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
    await expect(getSettings()).rejects.toThrow('登录状态已失效，请重新登录');

    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(getSettings()).rejects.toThrow('服务器暂时不可用，请稍后重试');
  });

  it('falls back for unknown codes and network failures', async () => {
    fetchMock.mockResolvedValueOnce(json({ _tag: 'Mystery' }, 400));
    await expect(getSettings()).rejects.toThrow('操作失败，请稍后重试');

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(getSettings()).rejects.toThrow(
      '网络连接失败，请检查网络后重试'
    );
  });

  it('rejects non-JSON success bodies', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));

    await expect(getSettings()).rejects.toThrow(
      '设置数据格式不正确，请稍后重试'
    );
  });
});

describe('settings mutations', () => {
  it('sends the retention payload as JSON', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await saveRetention(120);
    const [path, init] = lastCall();
    expect(path).toBe('/api/library/settings/retention');
    expect(init?.method).toBe('PUT');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ retention: 120 });
  });

  it('omits blank extraction fields', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await saveExtraction({
      provider: 'jina',
      jinaKey: '  ',
      browserEndpoint: ' ',
    });
    expect(JSON.parse(String(lastCall()[1]?.body))).toEqual({
      provider: 'jina',
    });
  });

  it('trims non-blank extraction fields', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await saveExtraction({
      provider: 'browser',
      jinaKey: ' key ',
      browserEndpoint: ' ws://127.0.0.1:9222 ',
    });
    expect(JSON.parse(String(lastCall()[1]?.body))).toEqual({
      provider: 'browser',
      jinaKey: 'key',
      browserEndpoint: 'ws://127.0.0.1:9222',
    });
  });

  it('deletes the saved key and browser endpoint', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));

    await clearJinaKey();
    expect(lastCall()[0]).toBe('/api/library/settings/key');
    expect(lastCall()[1]?.method).toBe('DELETE');

    await clearBrowserEndpoint();
    expect(lastCall()[0]).toBe('/api/library/settings/browser');
    expect(lastCall()[1]?.method).toBe('DELETE');
  });
});
