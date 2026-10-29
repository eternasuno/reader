import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type BulkReadScope,
  type BulkReadStatusChange,
  bulkReadMatches,
  feedBulkScope,
  publishBulkReadStatus,
  READER_BULK_READ_STATUS_CHANGED,
  readBulkStatusFromEvent,
} from '../../../src/components/organisms/reader-status';

const change = (
  scope: BulkReadScope,
  keys: readonly string[] = []
): BulkReadStatusChange => ({ kind: 'feed', keys, read: true, scope });

const feedSelection = { kind: 'feed', key: 'open' } as const;
const linkSelection = { kind: 'link', key: 'open' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bulk scope parsing', () => {
  it('accepts bulk details with a consistent scope', () => {
    expect(
      readBulkStatusFromEvent({
        detail: {
          kind: 'feed',
          keys: ['a', 'b'],
          read: true,
          scope: { kind: 'allfeeds' },
        },
      } as unknown as CustomEvent)
    ).toEqual({
      kind: 'feed',
      keys: ['a', 'b'],
      read: true,
      scope: { kind: 'allfeeds' },
    });
    expect(
      readBulkStatusFromEvent({
        detail: {
          kind: 'feed',
          keys: ['a', 1],
          read: true,
          scope: { kind: 'allfeeds' },
        },
      } as unknown as CustomEvent)
    ).toBeUndefined();
  });

  it('rejects missing, empty, and mismatched scopes', () => {
    for (const detail of [
      { kind: 'feed', keys: [], read: true },
      {
        kind: 'feed',
        keys: [],
        read: true,
        scope: { kind: 'singlefeed', feedKey: '' },
      },
      { kind: 'feed', keys: [], read: true, scope: { kind: 'links' } },
      {
        kind: 'link',
        keys: [],
        read: true,
        scope: { kind: 'singlefeed', feedKey: 'feed' },
      },
    ]) {
      expect(
        readBulkStatusFromEvent({ detail } as unknown as CustomEvent)
      ).toBeUndefined();
    }
  });
});

describe('bulk scope matching', () => {
  it('maps an empty feed key to all feeds and others to one feed', () => {
    expect(feedBulkScope('')).toEqual({ kind: 'allfeeds' });
    expect(feedBulkScope('feed')).toEqual({
      kind: 'singlefeed',
      feedKey: 'feed',
    });
  });

  it('matches scopes without relying on loaded keys', () => {
    expect(
      bulkReadMatches(change({ kind: 'links' }), linkSelection, undefined)
    ).toBe(true);
    expect(
      bulkReadMatches(change({ kind: 'allfeeds' }), feedSelection, undefined)
    ).toBe(true);
    expect(
      bulkReadMatches(
        change({ kind: 'singlefeed', feedKey: 'feed-a' }),
        feedSelection,
        'feed-a'
      )
    ).toBe(true);
    expect(
      bulkReadMatches(
        change({ kind: 'singlefeed', feedKey: 'feed-a' }),
        feedSelection,
        'feed-b'
      )
    ).toBe(false);
    expect(
      bulkReadMatches(change({ kind: 'allfeeds' }), linkSelection, undefined)
    ).toBe(false);
  });

  it('keeps loaded-key matching when the feed key is unknown', () => {
    expect(
      bulkReadMatches(
        change({ kind: 'singlefeed', feedKey: 'feed-a' }, ['open']),
        feedSelection,
        undefined
      )
    ).toBe(true);
  });
});

describe('bulk publication', () => {
  it('publishes scoped events even without loaded keys', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const event = change({ kind: 'singlefeed', feedKey: 'feed' });

    expect(publishBulkReadStatus({ _tag: 'Failure' }, event)).toBe(false);
    expect(publishBulkReadStatus({ _tag: 'Success' }, event)).toBe(true);
    const dispatched = dispatchEvent.mock.calls[0]?.[0] as CustomEvent;

    expect(dispatched.type).toBe(READER_BULK_READ_STATUS_CHANGED);
    expect(readBulkStatusFromEvent(dispatched)).toEqual(event);
  });
});
