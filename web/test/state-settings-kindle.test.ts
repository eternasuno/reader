import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';
import type { SettingsDrafts } from '../src/state';
import { makeKindleSettings as makeSettings } from './support/state-fixture';

vi.mock('../src/state/browserTimezone', () => ({
  browserTimezone: () => 'Asia/Shanghai',
}));

type StateModule = typeof import('../src/state');
type I18nModule = typeof import('../src/i18n');
type UiModule = typeof import('../src/ui');
type StoreSetter = import('solid-js').StoreSetter<SettingsDrafts>;

let state: StateModule;
let solid: typeof import('solid-js');
let i18n: I18nModule;
let ui: UiModule;
let fetchMock: ReturnType<typeof vi.fn>;
let drafts: SettingsDrafts;
let setDrafts: StoreSetter;
let disposeRoot: (() => void) | undefined;

const fresh = async (): Promise<void> => {
  disposeRoot?.();
  vi.resetModules();
  solid = await import('solid-js');
  i18n = await import('../src/i18n');
  ui = await import('../src/ui');
  state = await import('../src/state');
  disposeRoot = solid.createRoot((dispose) => {
    const [store, setStore] = solid.createStore<SettingsDrafts>(
      state.draftsFromSettings(null)
    );
    drafts = store;
    setDrafts = setStore;
    return dispose;
  });
};

afterEach(() => {
  disposeRoot?.();
  disposeRoot = undefined;
});

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  await fresh();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const noContent = (): Response => new Response(null, { status: 204 });

const queue = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(json(body, status));
};

const queueEmpty = (): void => {
  fetchMock.mockResolvedValueOnce(noContent());
};

const requestUrl = (call = 0): string =>
  String(fetchMock.mock.calls[call]?.[0]);

const requestInit = (call = 0): RequestInit =>
  (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

const requestBody = (call = 0): unknown => {
  const body = requestInit(call).body;
  return typeof body === 'string' ? JSON.parse(body) : body;
};

const load = async (loaded: Settings = makeSettings()): Promise<void> => {
  queue(loaded);
  queue({ running: false, items: [] });
  await state.loadSettings((next) => {
    setDrafts(() => state.draftsFromSettings(next));
  });
  solid.flush();
};

const SAVED_KINDLE = {
  kindleEmail: 'kindle@example.com',
  schedule: { hour: 8, minute: 0, timezone: 'Asia/Shanghai' },
  nextSendAt: '2026-11-20T00:00:00Z',
};

const edit = (patch: Partial<SettingsDrafts>): void => {
  setDrafts((d) => ({ ...d, ...patch }));
  solid.flush();
};

const loadWithoutSchedule = (): Promise<void> =>
  load(makeSettings({ kindle: { kindleEmail: 'kindle@example.com' } }));

/** Saves successfully and answers the follow-up `GET /api/settings` with `reread`. */
const saveRereading = async (reread: Settings): Promise<void> => {
  queueEmpty();
  queue(reread);
  await expect(state.saveKindle(drafts, setDrafts)).resolves.toBe(true);
  solid.flush();
};

const saveWithoutReread = async (): Promise<void> => {
  queueEmpty();
  queue({ error: 'SettingRepositoryError' }, 500);
  await expect(state.saveKindle(drafts, setDrafts)).resolves.toBe(true);
  solid.flush();
};

describe('kindle save', () => {
  it('sends the timezone inside the schedule and clears dirty state', async () => {
    await load();
    edit({
      kindleEmail: ' new@kindle.com ',
      timezone: 'Europe/Paris',
      scheduleHour: 7,
      scheduleMinute: 30,
    });
    expect(state.isSectionDirty('kindle', drafts)).toBe(true);
    const savedKindle = {
      kindleEmail: 'new@kindle.com',
      schedule: { hour: 7, minute: 30, timezone: 'Europe/Paris' },
      nextSendAt: '2026-11-21T05:30:00Z',
    };

    await saveRereading(makeSettings({ retention: 999, kindle: savedKindle }));

    expect(requestUrl(2)).toBe('/api/settings/kindle');
    expect(requestInit(2).method).toBe('PUT');
    const body = requestBody(2) as Record<string, unknown>;
    expect(body).toEqual({
      kindleEmail: 'new@kindle.com',
      schedule: { hour: 7, minute: 30, timezone: 'Europe/Paris' },
    });
    expect('timezone' in body).toBe(false);
    expect(requestUrl(3)).toBe('/api/settings');
    expect(state.settings()?.retention).toBe(100);
    expect(state.settings()?.kindle).toEqual(savedKindle);
    expect(drafts.kindleEmail).toBe('new@kindle.com');
    expect(state.isSectionDirty('kindle', drafts)).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.kindleSavedToast'))
    );
  });
});

describe('kindle schedule enable', () => {
  it('enables scheduled sending at the default 08:00 in the device time zone', async () => {
    await loadWithoutSchedule();
    edit({ scheduleEnabled: true });

    await saveRereading(
      makeSettings({
        kindle: {
          kindleEmail: 'kindle@example.com',
          schedule: { hour: 8, minute: 0, timezone: 'Asia/Shanghai' },
          nextSendAt: '2026-11-21T08:00:00Z',
        },
      })
    );

    expect(requestBody(2)).toEqual({
      kindleEmail: 'kindle@example.com',
      schedule: { hour: 8, minute: 0, timezone: 'Asia/Shanghai' },
    });
    expect(state.isSectionDirty('kindle', drafts)).toBe(false);
  });
});

describe('kindle schedule disable', () => {
  it('omits the schedule and the timezone when scheduled sending is off', async () => {
    await load();
    edit({ scheduleEnabled: false, scheduleHour: 21, scheduleMinute: 45 });
    const disabledKindle = { kindleEmail: 'kindle@example.com' };

    await saveRereading(makeSettings({ kindle: disabledKindle }));

    const body = requestBody(2) as Record<string, unknown>;
    expect(body).toEqual(disabledKindle);
    expect('schedule' in body).toBe(false);
    expect('timezone' in body).toBe(false);
    expect(state.settings()?.kindle).toEqual(disabledKindle);
    expect(state.settings()?.kindle?.nextSendAt).toBeUndefined();
    expect(state.isSectionDirty('kindle', drafts)).toBe(false);
  });

  it('does not send an edited timezone while scheduled sending stays off', async () => {
    await loadWithoutSchedule();
    edit({ kindleEmail: 'other@kindle.com', timezone: 'Asia/Tokyo' });

    await saveRereading(
      makeSettings({ kindle: { kindleEmail: 'other@kindle.com' } })
    );

    const body = requestBody(2) as Record<string, unknown>;
    expect(body).toEqual({ kindleEmail: 'other@kindle.com' });
    expect('timezone' in body).toBe(false);
    expect(state.isSectionDirty('kindle', drafts)).toBe(false);
  });
});

describe('kindle save fallback', () => {
  it('falls back to the submitted values and clears nextSendAt when the schedule changed and the re-read fails', async () => {
    await load();
    edit({ kindleEmail: 'fallback@kindle.com', scheduleHour: 9 });

    await saveWithoutReread();

    expect(state.settings()?.kindle).toEqual({
      kindleEmail: 'fallback@kindle.com',
      schedule: { hour: 9, minute: 0, timezone: 'Asia/Shanghai' },
    });
    expect(state.settings()?.kindle?.nextSendAt).toBeUndefined();
    expect(state.isSectionDirty('kindle', drafts)).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.kindleSavedToast'))
    );
  });

  it.each([
    ['hour', { scheduleHour: 9 }],
    ['minute', { scheduleMinute: 30 }],
    ['timezone', { timezone: 'UTC' }],
    ['schedule toggle', { scheduleEnabled: false }],
  ])(
    'clears nextSendAt when the %s changed and the re-read fails',
    async (_, patch) => {
      await load();
      edit(patch);

      await saveWithoutReread();

      expect(state.settings()?.kindle?.nextSendAt).toBeUndefined();
    }
  );

  it('keeps nextSendAt when only the address changed and the re-read fails', async () => {
    await load();
    edit({ kindleEmail: 'fallback@kindle.com' });

    await saveWithoutReread();

    expect(state.settings()?.kindle).toEqual({
      ...SAVED_KINDLE,
      kindleEmail: 'fallback@kindle.com',
    });
  });
});

describe('kindle save failure', () => {
  it.each([
    {
      error: 'InvalidKindleSetting',
      status: 400,
      email: 'bad-email',
      initial: makeSettings(),
    },
    {
      error: 'SMTPNotConfigured',
      status: 422,
      email: 'a@kindle.com',
      initial: makeSettings({ smtp: undefined, kindle: undefined }),
    },
  ])(
    'reports $error and preserves saved settings',
    async ({ error, status, email, initial }) => {
      await load(initial);
      setDrafts((d) => ({ ...d, kindleEmail: email }));
      solid.flush();
      queue({ error }, status);

      await expect(state.saveKindle(drafts, setDrafts)).resolves.toBe(false);
      solid.flush();
      expect(state.settings()?.kindle).toEqual(initial.kindle);
      expect(ui.currentToast()?.message).toBe(i18n.translateErrorCode(error));
      expect(state.isSaving()).toBe(false);
    }
  );
});
