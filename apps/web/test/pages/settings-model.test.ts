import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSettingsStores,
  isSectionDirty,
  isSettingsBusy,
  removeJinaKey,
  resetSettingsSection,
  submitFetcher,
  submitRetention,
  useSettingsModel,
} from '../../src/pages/settings-model';

const fetchMock = vi.fn();

type StoredSettings = {
  retention: number;
  provider: 'jina' | 'browser';
  jinaKeyConfigured: boolean;
  browserEndpointConfigured: boolean;
};

const baseline: StoredSettings = {
  retention: 100,
  provider: 'jina',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
};

const form = {
  classList: { add: () => undefined },
  checkValidity: () => true,
} as unknown as HTMLFormElement;

const okResponse = () => new Response('', { status: 200 });

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let disposers: Array<() => void> = [];

const setup = (stored: StoredSettings = baseline) => {
  const [stores, dispose] = createRoot((disposeRoot) => {
    const created = createSettingsStores();
    created.drafts.setSettings(stored);
    created.drafts.setRetention(String(stored.retention));
    created.drafts.setProvider(stored.provider);

    return [created, disposeRoot] as const;
  });
  disposers.push(dispose);

  return stores;
};

const setupModel = () => {
  const [model, dispose] = createRoot(
    (disposeRoot) => [useSettingsModel(), disposeRoot] as const
  );
  disposers.push(dispose);

  return model;
};

const flush = async () => {
  for (let tick = 0; tick < 3; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const lastCall = (): [string, RequestInit | undefined] => {
  const call = fetchMock.mock.calls.at(-1);

  return [String(call?.[0]), call?.[1] as RequestInit | undefined];
};

const lastBody = (): unknown => JSON.parse(String(lastCall()[1]?.body));

const confirmStub = (answer: boolean) => {
  const confirm = vi.fn(() => answer);
  vi.stubGlobal('window', { confirm });

  return confirm;
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const dispose of disposers) dispose();

  disposers = [];
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('settings flags load', () => {
  it('loads only the configured flags and prefills no secret', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          ...baseline,
          jinaKeyConfigured: true,
          browserEndpointConfigured: true,
        },
        200
      )
    );
    const model = setupModel();

    await flush();

    expect(model.status.loadError()).toBe('');
    expect(model.drafts.settings()).toEqual({
      ...baseline,
      jinaKeyConfigured: true,
      browserEndpointConfigured: true,
    });
    expect(model.drafts.jinaKey()).toBe('');
    expect(model.drafts.browserEndpoint()).toBe('');
    expect(isSectionDirty(model.drafts, 'extraction')).toBe(false);
  });
});

describe('settings provider draft', () => {
  it('changes only the visible field without saving', () => {
    const { drafts } = setup();

    drafts.setProvider('browser');

    expect(drafts.provider()).toBe('browser');
    expect(drafts.settings()?.provider).toBe('jina');
    expect(isSectionDirty(drafts, 'extraction')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    resetSettingsSection(drafts, 'extraction');

    expect(drafts.provider()).toBe('jina');
    expect(isSectionDirty(drafts, 'extraction')).toBe(false);
  });
});

describe('settings retention save', () => {
  it('applies the value and blocks section switches while saving', async () => {
    let finish: (() => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(okResponse());
        })
    );

    const { drafts, status } = setup();

    expect(isSettingsBusy(status)).toBe(false);

    drafts.setRetention('200');
    submitRetention(drafts, status, form);
    await flush();

    expect(isSettingsBusy(status)).toBe(true);
    expect(drafts.settings()?.retention).toBe(baseline.retention);

    // A discard that used to slip through mid-flight reset the draft to the
    // old baseline while the save still applied the new value on completion.
    resetSettingsSection(drafts, 'articles');
    expect(drafts.retention()).toBe(String(baseline.retention));

    finish?.();
    await flush();

    expect(isSettingsBusy(status)).toBe(false);
    expect(drafts.settings()?.retention).toBe(200);
    expect(drafts.retention()).toBe('200');
    expect(isSectionDirty(drafts, 'articles')).toBe(false);
  });
});

describe('settings Jina key save', () => {
  it('saves a typed key and reports the configured flag', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { drafts, status } = setup();

    drafts.setJinaKey('  sk-live  ');
    submitFetcher(drafts, status, form);
    await flush();

    expect(lastCall()[0]).toBe('/api/library/settings/fetcher');
    expect(lastCall()[1]?.method).toBe('PUT');
    expect(lastBody()).toEqual({ provider: 'jina', key: 'sk-live' });
    expect(drafts.settings()).toMatchObject({
      provider: 'jina',
      jinaKeyConfigured: true,
      browserEndpointConfigured: false,
    });
    expect(drafts.jinaKey()).toBe('');
    expect(status.toast()).toMatchObject({ kind: 'success' });
  });
});

describe('settings blank Jina key save', () => {
  it('keeps the stored key', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { drafts, status } = setup({
      ...baseline,
      jinaKeyConfigured: true,
    });

    drafts.setJinaKey('   ');
    submitFetcher(drafts, status, form);
    await flush();

    expect(lastBody()).toEqual({ provider: 'jina' });
    expect(drafts.settings()).toMatchObject({
      provider: 'jina',
      jinaKeyConfigured: true,
    });
  });
});

describe('settings browser address save', () => {
  it('replaces a stored address and reports only that provider', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { drafts, status } = setup({
      ...baseline,
      browserEndpointConfigured: true,
    });

    drafts.setJinaKey('  sk-live  ');
    drafts.setProvider('browser');
    drafts.setBrowserEndpoint(' ws://127.0.0.1:9222 ');
    submitFetcher(drafts, status, form);
    await flush();

    expect(lastBody()).toEqual({
      provider: 'browser',
      endpoint: 'ws://127.0.0.1:9222',
    });
    expect(drafts.settings()).toMatchObject({
      provider: 'browser',
      jinaKeyConfigured: false,
      browserEndpointConfigured: true,
    });
    expect(drafts.browserEndpoint()).toBe('');
    expect(drafts.jinaKey()).toBe('  sk-live  ');
  });

  it('switches to the browser without retyping a stored address', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const { drafts, status } = setup({
      ...baseline,
      browserEndpointConfigured: true,
    });

    drafts.setProvider('browser');
    submitFetcher(drafts, status, form);
    await flush();

    expect(lastBody()).toEqual({ provider: 'browser' });
    expect(drafts.settings()).toMatchObject({
      provider: 'browser',
      browserEndpointConfigured: true,
    });
  });
});

describe('settings Jina key clear', () => {
  it('clears the key after the confirmation and keeps the provider', async () => {
    const confirm = confirmStub(true);
    fetchMock.mockResolvedValue(okResponse());
    const { drafts, status } = setup({
      ...baseline,
      provider: 'browser',
      jinaKeyConfigured: true,
      browserEndpointConfigured: true,
    });

    removeJinaKey(drafts, status);
    await flush();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(lastCall()[0]).toBe('/api/library/settings/key');
    expect(lastCall()[1]).toMatchObject({ method: 'DELETE' });
    expect(drafts.settings()).toMatchObject({
      provider: 'browser',
      jinaKeyConfigured: false,
      browserEndpointConfigured: true,
    });
    expect(status.toast()).toMatchObject({ kind: 'success' });
  });

  it('keeps the key when the confirmation is cancelled', async () => {
    const confirm = confirmStub(false);
    const { drafts, status } = setup({
      ...baseline,
      jinaKeyConfigured: true,
    });

    removeJinaKey(drafts, status);
    await flush();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(drafts.settings()?.jinaKeyConfigured).toBe(true);
    expect(status.toast()).toBeUndefined();
  });
});
