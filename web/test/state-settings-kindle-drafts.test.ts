import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Settings } from '../src/api';
import type { SettingsDrafts } from '../src/state';
import {
  createStateTestContext,
  makeKindleSettings,
} from './support/state-fixture';

type StoreSetter = import('solid-js').StoreSetter<SettingsDrafts>;

const ctx = createStateTestContext();
let drafts: SettingsDrafts;
let setDrafts: StoreSetter;
let disposeRoot: (() => void) | undefined;

beforeEach(async () => {
  await ctx.reset();
  disposeRoot = ctx.solid.createRoot((dispose) => {
    const [store, setStore] = ctx.solid.createStore<SettingsDrafts>(
      ctx.state.draftsFromSettings(null)
    );
    drafts = store;
    setDrafts = setStore;
    return dispose;
  });
});

afterEach(() => {
  disposeRoot?.();
  disposeRoot = undefined;
});

const load = async (loaded: Settings = makeKindleSettings()): Promise<void> => {
  ctx.queue(loaded);
  ctx.queue({ running: false, items: [] });
  await ctx.state.loadSettings((next) => {
    setDrafts(() => ctx.state.draftsFromSettings(next));
  });
  ctx.solid.flush();
};

const loadWithoutSchedule = (): Promise<void> =>
  load(makeKindleSettings({ kindle: { kindleEmail: 'kindle@example.com' } }));

const edit = (patch: Partial<SettingsDrafts>): void => {
  setDrafts((d) => ({ ...d, ...patch }));
  ctx.solid.flush();
};

const kindleDirty = (): boolean => ctx.state.isSectionDirty('kindle', drafts);

describe('kindle drafts from settings', () => {
  it('defaults to UTC with scheduled sending off at 08:00 when Kindle is not configured', async () => {
    await load(makeKindleSettings({ kindle: undefined }));

    expect(drafts.kindleEmail).toBe('');
    expect(drafts.timezone).toBe('UTC');
    expect(drafts.scheduleEnabled).toBe(false);
    expect(drafts.scheduleHour).toBe(8);
    expect(drafts.scheduleMinute).toBe(0);
    expect(kindleDirty()).toBe(false);
  });

  it('loads a Kindle address without a schedule as disabled with the default time and UTC', async () => {
    await loadWithoutSchedule();

    expect(drafts.timezone).toBe('UTC');
    expect(drafts.scheduleEnabled).toBe(false);
    expect(drafts.scheduleHour).toBe(8);
    expect(drafts.scheduleMinute).toBe(0);
    expect(kindleDirty()).toBe(false);
  });

  it('loads a saved schedule as enabled with its time and timezone', async () => {
    await load(
      makeKindleSettings({
        kindle: {
          kindleEmail: 'kindle@example.com',
          schedule: { hour: 21, minute: 45, timezone: 'Asia/Tokyo' },
        },
      })
    );

    expect(drafts.timezone).toBe('Asia/Tokyo');
    expect(drafts.scheduleEnabled).toBe(true);
    expect(drafts.scheduleHour).toBe(21);
    expect(drafts.scheduleMinute).toBe(45);
  });
});

describe('kindle dirty tracking', () => {
  it.each([
    ['timezone', { timezone: 'UTC' }],
    ['schedule toggle', { scheduleEnabled: false }],
    ['hour', { scheduleHour: 9 }],
    ['minute', { scheduleMinute: 5 }],
  ])('marks the saved schedule dirty when %s changes', async (_, patch) => {
    await load();

    edit(patch);
    expect(kindleDirty()).toBe(true);
    expect(ctx.state.hasAnyUnsavedChanges(drafts)).toBe(true);
  });

  it('ignores hour, minute and timezone while scheduled sending is disabled', async () => {
    await loadWithoutSchedule();

    edit({ scheduleHour: 21, scheduleMinute: 45, timezone: 'Asia/Tokyo' });
    expect(kindleDirty()).toBe(false);

    edit({ scheduleEnabled: true });
    expect(kindleDirty()).toBe(true);

    edit({ scheduleHour: 8, scheduleMinute: 0, timezone: 'UTC' });
    expect(kindleDirty()).toBe(true);

    edit({ scheduleEnabled: false });
    expect(kindleDirty()).toBe(false);
  });

  it('ignores a timezone change when the saved schedule is disabled in the draft', async () => {
    await load();

    edit({ scheduleEnabled: false, timezone: 'Asia/Tokyo' });
    expect(kindleDirty()).toBe(true);

    edit({ scheduleEnabled: true });
    expect(kindleDirty()).toBe(true);

    edit({ timezone: 'Asia/Shanghai' });
    expect(kindleDirty()).toBe(false);
  });
});
