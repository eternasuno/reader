import { describe, expect, it } from '@effect/vitest';
import type { FeedItemKey } from '../../../../src/port/feed-item-repository';
import { selectItems } from '../../../../src/usecase/feed/refresh-feed/selection';
import { decodeUrl, makeUniqueFeedItem } from '../../../support/fixtures';
import { parsedEntry, urlsOf } from '../support';

/** An inventory in list order: the first key is the item on top (FD-LIST-4). */
const inventoryOf = (urls: ReadonlyArray<string>): ReadonlyArray<FeedItemKey> =>
  urls.map((url) => {
    const item = makeUniqueFeedItem({ url: decodeUrl(url) });

    return { id: item.id, url: item.url };
  });

const entriesOf = (
  urls: ReadonlyArray<string>
): ReadonlyArray<ReturnType<typeof parsedEntry>> =>
  urls.map((url) => parsedEntry(url, { title: url }));

describe('selectItems', () => {
  it('FD-SEL-8 a new feed imports the first N entries in source order', () => {
    const selection = selectItems(
      [],
      entriesOf([
        'https://example.com/d',
        'https://example.com/c',
        'https://example.com/b',
        'https://example.com/a',
      ]),
      3
    );

    expect(urlsOf(selection.toImport)).toEqual([
      'https://example.com/d',
      'https://example.com/c',
      'https://example.com/b',
    ]);
    expect(selection.toRemove).toEqual([]);
  });

  it('FD-SEL-1 entries with the same URL collapse to the first one', () => {
    const selection = selectItems(
      [],
      entriesOf([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/a',
        'https://example.com/c',
      ]),
      3
    );

    expect(urlsOf(selection.toImport)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });
});

describe('selectItems duplicates and N', () => {
  it('FD-SEL-6 an entry beyond the first N is never imported', () => {
    const selection = selectItems(
      [],
      entriesOf([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
        'https://example.com/d',
      ]),
      3
    );

    expect(urlsOf(selection.toImport)).toHaveLength(3);
  });

  it('FD-SEL-2 a stored entry is not imported again', () => {
    const selection = selectItems(
      inventoryOf(['https://example.com/a']),
      entriesOf(['https://example.com/a', 'https://example.com/b']),
      3
    );

    expect(urlsOf(selection.toImport)).toEqual(['https://example.com/b']);
    expect(selection.toRemove).toEqual([]);
  });
});

describe('selectItems stored items', () => {
  it('FD-SEL-3 removes the unlisted stored items at the bottom of the list', () => {
    const inventory = inventoryOf([
      'https://example.com/c',
      'https://example.com/b',
      'https://example.com/a',
    ]);
    const selection = selectItems(
      inventory,
      entriesOf([
        'https://example.com/d',
        'https://example.com/c',
        'https://example.com/b',
      ]),
      3
    );

    expect(urlsOf(selection.toImport)).toEqual(['https://example.com/d']);
    expect(selection.toRemove).toEqual([inventory[2]?.id]);
  });

  it('FD-SEL-3 keeps the other stored items in list order until N', () => {
    const inventory = inventoryOf([
      'https://example.com/c',
      'https://example.com/b',
      'https://example.com/a',
    ]);
    const selection = selectItems(
      inventory,
      entriesOf(['https://example.com/d']),
      3
    );

    expect(selection.toRemove).toEqual([inventory[2]?.id]);
  });
});

describe('selectItems retention', () => {
  it('FD-SEL-5 an item the source no longer lists stays while room is left', () => {
    const selection = selectItems(
      inventoryOf([
        'https://example.com/c',
        'https://example.com/b',
        'https://example.com/a',
      ]),
      entriesOf(['https://example.com/c']),
      3
    );

    expect(selection.toImport).toEqual([]);
    expect(selection.toRemove).toEqual([]);
  });

  it('FD-SEL-7 a lowered N removes the oldest items at the next sync', () => {
    const inventory = inventoryOf([
      'https://example.com/e',
      'https://example.com/d',
      'https://example.com/c',
      'https://example.com/b',
    ]);
    const selection = selectItems(
      inventory,
      entriesOf(['https://example.com/e']),
      2
    );

    expect(selection.toRemove).toEqual([inventory[2]?.id, inventory[3]?.id]);
  });
});
