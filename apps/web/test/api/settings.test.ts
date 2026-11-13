import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSettings,
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

const lastBody = (): unknown => {
  const call = fetchMock.mock.calls.at(-1);

  return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
};

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
  });
});

describe('settings mutations', () => {
  it('omits a blank Jina key', async () => {
    fetchMock.mockResolvedValue(ok());

    await useJinaFetcher('  ');

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

    expect(lastBody()).toEqual({});
  });

  it('sends a trimmed browser endpoint', async () => {
    fetchMock.mockResolvedValue(ok());

    await useBrowserFetcher(' ws://127.0.0.1:9222 ');

    expect(lastBody()).toEqual({ endpoint: 'ws://127.0.0.1:9222' });
  });
});
