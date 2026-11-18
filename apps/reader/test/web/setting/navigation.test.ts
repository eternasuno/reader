import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leaveDecision } from '../../../src/web/setting/leave';
import {
  createSectionSwitch,
  settingsSections,
  switchSection,
} from '../../../src/web/setting/section';
import { dismissToast, toasts } from '../../../src/web/ui/toast';

/**
 * Switching sections and leaving the page (settings.md Saving and unsaved
 * changes): beside the sections a changed one asks before it is discarded,
 * stacked the press only scrolls, and a write in flight blocks both.
 */

const switchCopy = '当前分区有未保存的修改，切换后将被丢弃。确定继续吗？';
const leaveCopy = '有未保存的修改，确定离开设置页吗？';
const busyCopy = '正在保存设置，完成前无法切换分区或离开本页。';

const options = (over: Partial<Parameters<typeof switchSection>[0]> = {}) => ({
  open: 'articles' as const,
  target: 'extraction' as const,
  beside: true,
  changed: () => false,
  saving: false,
  confirm: () => true,
  discard: vi.fn(),
  ...over,
});

const messagesOf = (kind: 'success' | 'error'): ReadonlyArray<string> =>
  toasts()
    .filter((toast) => toast.kind === kind)
    .map((toast) => toast.message);

beforeEach(() => {
  vi.useFakeTimers();

  for (const toast of toasts()) dismissToast(toast.id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pressing a navigation item', () => {
  it('opens the target and drops the open section’s drafts', () => {
    const discard = vi.fn();
    const confirm = vi.fn(() => true);

    expect(switchSection(options({ discard, confirm }))).toBe('opened');
    expect(confirm).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith('articles');
  });

  it('Scenario: Changing the provider alone does not save — the switch asks first', () => {
    const confirm = vi.fn(() => false);
    const discard = vi.fn();

    const result = switchSection(
      options({
        changed: () => true,
        confirm,
        discard,
        open: 'extraction',
        target: 'account',
      })
    );

    expect(result).toBe('stayed');
    expect(confirm).toHaveBeenCalledWith(switchCopy);
    expect(discard).not.toHaveBeenCalled();
  });

  it('discards the changed section when the switch is confirmed', () => {
    const discard = vi.fn();

    const result = switchSection(
      options({ changed: () => true, confirm: () => true, discard })
    );

    expect(result).toBe('opened');
    expect(discard).toHaveBeenCalledWith('articles');
  });
});

describe('a press that does not switch', () => {
  it('Scenario: A narrow screen stacks the sections without discarding drafts', () => {
    const confirm = vi.fn(() => true);
    const discard = vi.fn();

    const result = switchSection(
      options({ beside: false, changed: () => true, confirm, discard })
    );

    expect(result).toBe('scrolled');
    expect(confirm).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it('ignores the press while a write runs', () => {
    const confirm = vi.fn(() => true);
    const discard = vi.fn();

    expect(switchSection(options({ saving: true, confirm, discard }))).toBe(
      'stayed'
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it('does nothing for the open section', () => {
    const discard = vi.fn();

    expect(switchSection(options({ target: 'articles', discard }))).toBe(
      'stayed'
    );
    expect(discard).not.toHaveBeenCalled();
  });
});

describe('leaving the page', () => {
  it('leaves freely when no section changed', () => {
    const confirm = vi.fn(() => true);

    expect(leaveDecision({ saving: false, changed: false, confirm })).toBe(
      'leave'
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });

  it('Scenario: Leaving with unsaved changes asks first', () => {
    const confirm = vi.fn(() => false);

    expect(leaveDecision({ saving: false, changed: true, confirm })).toBe(
      'stay'
    );
    expect(confirm).toHaveBeenCalledWith(leaveCopy);
  });

  it('leaves with unsaved changes once the confirmation is given', () => {
    expect(
      leaveDecision({ saving: false, changed: true, confirm: () => true })
    ).toBe('leave');
  });

  it('Scenario: A save cannot be lost by leaving', () => {
    const confirm = vi.fn(() => true);

    expect(leaveDecision({ saving: true, changed: false, confirm })).toBe(
      'stay'
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(messagesOf('error')).toEqual([busyCopy]);
  });
});

const pageSwitch = (
  over: Partial<Parameters<typeof createSectionSwitch>[0]> = {}
) =>
  createSectionSwitch({
    beside: () => true,
    accountChanged: () => false,
    draftChanged: () => false,
    saving: () => false,
    confirm: () => true,
    discard: () => undefined,
    scroll: () => undefined,
    ...over,
  });

describe('the sections of the page', () => {
  it('lists the four sections in page order (settings.md Interface)', () => {
    expect(settingsSections.map((item) => item.id)).toEqual([
      'account',
      'articles',
      'extraction',
      'kindle',
    ]);
    expect(settingsSections.map((item) => item.name)).toEqual([
      '账号',
      '文章',
      '提取',
      'Kindle',
    ]);
  });

  it('counts a changed Kindle section as unsaved changes', () => {
    const switched = pageSwitch({
      draftChanged: (section) => section === 'kindle',
    });

    expect(switched.anyChanged()).toBe(true);
  });
});

describe('the page’s open section', () => {
  it('starts on 账号', () => {
    expect(pageSwitch().open()).toBe('account');
  });

  it('scrolls to the pressed section in the stacked layout and marks it', () => {
    const scroll = vi.fn();
    const switched = pageSwitch({ beside: () => false, scroll });

    switched.pick('extraction');

    expect(scroll).toHaveBeenCalledWith('extraction');
    expect(switched.open()).toBe('extraction');
  });

  it('reports any changed section, 账号 included', () => {
    expect(pageSwitch().anyChanged()).toBe(false);
    expect(pageSwitch({ accountChanged: () => true }).anyChanged()).toBe(true);
    expect(
      pageSwitch({
        draftChanged: (section) => section === 'articles',
      }).anyChanged()
    ).toBe(true);
  });
});
