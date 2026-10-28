import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  projectReadStatus,
  publishReadStatus,
  READER_READ_STATUS_CHANGED,
  readStatusFromEvent,
  reconcileReadOverrides,
  recordReadOverride,
} from '../../../src/components/organisms/reader-status';

const items = [
  { key: 'first', read: false },
  { key: 'second', read: true },
  { key: 'third', read: false },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('read status projection', () => {
  it('keeps membership and order while projecting one changed item', () => {
    const overrides = recordReadOverride(items, new Map(), {
      kind: 'link',
      key: 'first',
      read: true,
    });
    const projected = projectReadStatus(items, overrides);

    expect(projected?.map((item) => item.key)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(projected?.map((item) => item.read)).toEqual([true, true, false]);
    expect(projected?.[1]).toBe(items[1]);
    expect(projected?.[2]).toBe(items[2]);
  });

  it('bounds overrides to current-result keys and clears confirmed statuses', () => {
    const empty = new Map<string, boolean>();
    expect(
      recordReadOverride(items, empty, {
        kind: 'link',
        key: 'missing',
        read: true,
      })
    ).toBe(empty);
    const matching = recordReadOverride(items, empty, {
      kind: 'link',
      key: 'second',
      read: true,
    });

    expect(matching).toEqual(new Map([['second', true]]));
    expect(projectReadStatus(items, matching)).toBe(items);
    expect(reconcileReadOverrides(items, matching)).toEqual(new Map());
  });
});

describe('read status loading', () => {
  it('buffers statuses while loading and lets the first result win', () => {
    const buffered = recordReadOverride(undefined, new Map(), {
      kind: 'link',
      key: 'first',
      read: true,
    });

    expect(buffered).toEqual(new Map([['first', true]]));
    expect(reconcileReadOverrides(undefined, buffered)).toBe(buffered);
    expect(reconcileReadOverrides(items, buffered)).toEqual(new Map());
  });
});

describe('read status reconciliation', () => {
  it('follows the latest status for a key', () => {
    const changed = recordReadOverride(items, new Map(), {
      kind: 'link',
      key: 'first',
      read: true,
    });
    const reverted = recordReadOverride(items, changed, {
      kind: 'link',
      key: 'first',
      read: false,
    });

    expect(reverted).toEqual(new Map([['first', false]]));
    expect(projectReadStatus(items, reverted)?.[0]?.read).toBe(false);
  });

  it('lets a later disagreeing fetch win over local marks', () => {
    const marked = recordReadOverride(items, new Map(), {
      kind: 'link',
      key: 'first',
      read: true,
    });
    const fetched = items.map((item) =>
      item.key === 'first' ? { ...item, read: false } : item
    );

    expect(projectReadStatus(items, marked)?.[0]?.read).toBe(true);
    const reconciled = reconcileReadOverrides(fetched, marked);

    expect(reconciled).toEqual(new Map());
    expect(projectReadStatus(fetched, reconciled)).toBe(fetched);
  });

  it('clears all overrides when a new result arrives', () => {
    const overrides = new Map([
      ['first', true],
      ['third', true],
      ['missing', true],
    ]);

    expect(reconcileReadOverrides(items, overrides)).toEqual(new Map());
    expect(
      reconcileReadOverrides([{ key: 'second', read: true }], overrides)
    ).toEqual(new Map());
  });
});

describe('read status events', () => {
  it('publishes only successful mark results', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const change = { kind: 'feed', key: 'article', read: true } as const;

    expect(publishReadStatus({ _tag: 'Failure' }, change)).toBe(false);
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(publishReadStatus({ _tag: 'Success' }, change)).toBe(true);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent;
    expect(event.type).toBe(READER_READ_STATUS_CHANGED);
    expect(readStatusFromEvent(event)).toEqual(change);
  });

  it('rejects malformed event details', () => {
    for (const detail of [
      null,
      'read',
      { kind: 'other', key: 'x', read: true },
      { kind: 'link', key: 1, read: true },
      { kind: 'link', key: 'x', read: 'yes' },
    ]) {
      expect(
        readStatusFromEvent({ detail } as unknown as CustomEvent)
      ).toBeUndefined();
    }
  });
});
