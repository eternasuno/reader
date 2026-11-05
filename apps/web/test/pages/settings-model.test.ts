import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSettingsStores,
  isSectionDirty,
  isSettingsBusy,
  resetSettingsSection,
  submitRetention,
  useSettingsModel,
} from '../../src/pages/settings-model';

const fetchMock = vi.fn();

const baseline = {
  retention: 100,
  provider: 'jina' as const,
  jinaConfigured: false,
  browserEndpoint: '',
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

const setup = () => {
  const [stores, dispose] = createRoot((disposeRoot) => {
    const created = createSettingsStores();
    created.drafts.setSettings(baseline);
    created.drafts.setRetention(String(baseline.retention));

    return [created, disposeRoot] as const;
  });

  return { ...stores, dispose };
};

const flush = async () => {
  for (let tick = 0; tick < 3; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('settings busy guard', () => {
  it('blocks section switches for the whole save and re-syncs the draft', async () => {
    let finish: (() => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(okResponse());
        })
    );

    const { drafts, status, dispose } = setup();
    try {
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
    } finally {
      dispose();
    }
  });

  it('ignores overlapping submissions while a save is pending', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));

    const { drafts, status, dispose } = setup();
    try {
      drafts.setRetention('200');
      submitRetention(drafts, status, form);
      await flush();
      submitRetention(drafts, status, form);
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });
});

describe('settings draft state', () => {
  it('loads a missing browser endpoint into an empty draft', async () => {
    fetchMock.mockResolvedValue(
      json({ retention: 100, provider: 'jina', jinaConfigured: false }, 200)
    );
    const [model, dispose] = createRoot(
      (disposeRoot) => [useSettingsModel(), disposeRoot] as const
    );

    try {
      await flush();

      expect(model.status.loadError()).toBe('');
      expect(model.drafts.settings()?.browserEndpoint).toBeUndefined();
      expect(model.drafts.browserEndpoint()).toBe('');
      expect(isSectionDirty(model.drafts, 'extraction')).toBe(false);
    } finally {
      dispose();
    }
  });

  it('treats a missing saved endpoint as an empty draft when resetting', () => {
    const { drafts, dispose } = setup();
    try {
      drafts.setSettings({
        retention: baseline.retention,
        provider: baseline.provider,
        jinaConfigured: baseline.jinaConfigured,
      });
      drafts.setBrowserEndpoint('ws://127.0.0.1:9222');
      expect(isSectionDirty(drafts, 'extraction')).toBe(true);

      resetSettingsSection(drafts, 'extraction');
      expect(drafts.browserEndpoint()).toBe('');
      expect(isSectionDirty(drafts, 'extraction')).toBe(false);
    } finally {
      dispose();
    }
  });

  it('tracks retention dirtiness and restores the baseline on reset', () => {
    const { drafts, dispose } = setup();
    try {
      expect(isSectionDirty(drafts, 'articles')).toBe(false);

      drafts.setRetention('30');
      expect(isSectionDirty(drafts, 'articles')).toBe(true);

      resetSettingsSection(drafts, 'articles');
      expect(isSectionDirty(drafts, 'articles')).toBe(false);
      expect(drafts.retention()).toBe('100');
    } finally {
      dispose();
    }
  });
});

describe('settings error text', () => {
  it('surfaces mapped API codes instead of backend messages', async () => {
    fetchMock.mockResolvedValue(
      json({ _tag: 'InvalidRetention', message: 'backend text' }, 400)
    );

    const { drafts, status, dispose } = setup();
    try {
      drafts.setRetention('200');
      submitRetention(drafts, status, form);
      await flush();

      const toast = status.toast();
      expect(toast?.kind).toBe('error');
      expect(toast?.message).toBe('保留数量必须是 30 到 300 之间的整数');
      expect(toast?.message).not.toContain('backend');
      expect(status.loadError()).toBe('');
      expect(drafts.settings()?.retention).toBe(baseline.retention);
      expect(isSettingsBusy(status)).toBe(false);
    } finally {
      dispose();
    }
  });
});
