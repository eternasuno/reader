import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearJinaKey,
  getSettings,
  saveRetention,
  useBrowserFetcher,
  useJinaFetcher,
} from '../../src/api/settings';

const fetchMock = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const ok = () => json({ ok: true });

const settings = {
  retention: 120,
  provider: 'jina',
  jinaKeyConfigured: true,
  browserEndpointConfigured: false,
};

const lastCall = (): [string, RequestInit | undefined] => {
  const call = fetchMock.mock.calls.at(-1);

  return [
    new URL(String(call?.[0])).pathname,
    call?.[1] as RequestInit | undefined,
  ];
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
    expect(lastCall()[0]).toBe('/api/library/settings');
    expect(lastCall()[1]?.method).toBe('GET');
  });
});

describe('settings mutations', () => {
  it('sends the retention payload as JSON', async () => {
    fetchMock.mockResolvedValue(ok());

    await saveRetention(120);
    expect(lastCall()[0]).toBe('/api/library/settings/retention');
    expect(lastCall()[1]?.method).toBe('PUT');
    expect(lastBody()).toEqual({ retention: 120 });
  });

  it('omits a blank Jina key', async () => {
    fetchMock.mockResolvedValue(ok());

    await useJinaFetcher('  ');

    expect(lastCall()[0]).toBe('/api/library/settings/fetcher/jina');
    expect(lastCall()[1]?.method).toBe('PUT');
    expect(lastBody()).toEqual({});
  });

  it('sends a trimmed Jina key', async () => {
    fetchMock.mockResolvedValue(ok());

    await useJinaFetcher(' key ');

    expect(lastBody()).toEqual({ key: 'key' });
  });

  it('omits a blank browser endpoint', async () => {
    fetchMock.mockResolvedValue(ok());

    await useBrowserFetcher(' ');

    expect(lastCall()[0]).toBe('/api/library/settings/fetcher/browser');
    expect(lastBody()).toEqual({});
  });

  it('sends a trimmed browser endpoint', async () => {
    fetchMock.mockResolvedValue(ok());

    await useBrowserFetcher(' ws://127.0.0.1:9222 ');

    expect(lastBody()).toEqual({ endpoint: 'ws://127.0.0.1:9222' });
  });

  it('deletes the saved key', async () => {
    fetchMock.mockResolvedValue(ok());

    await clearJinaKey();
    expect(lastCall()[0]).toBe('/api/library/settings/key');
    expect(lastCall()[1]?.method).toBe('DELETE');
  });
});
