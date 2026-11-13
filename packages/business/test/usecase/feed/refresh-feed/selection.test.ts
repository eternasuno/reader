import { describe, expect, it } from '@effect/vitest';
import type { FeedItemKey } from '../../../../src/port/feed-item-repository';
import type { ParsedFeedEntry } from '../../../../src/port/feed-parser';
import {
  type Selection,
  selectItems,
} from '../../../../src/usecase/feed/refresh-feed';
import { decodeUrl, makeFeedItem } from '../../../support/fixtures';
import { parsedEntry } from '../../../support/usecase/feed';

const base = 'https://example.com';

const inventoryOf = (
  letters: ReadonlyArray<string>
): ReadonlyArray<FeedItemKey> =>
  letters.map((letter) => {
    const item = makeFeedItem({ url: decodeUrl(`${base}/${letter}`) });

    return { id: item.id, url: item.url };
  });

const entriesOf = (
  letters: ReadonlyArray<string>
): ReadonlyArray<ParsedFeedEntry> =>
  letters.map((letter) => parsedEntry(`${base}/${letter}`));

const keptUrls = (
  inventory: ReadonlyArray<FeedItemKey>,
  selection: Selection
): ReadonlyArray<string> =>
  inventory
    .filter((item) => !selection.toRemove.includes(item.id))
    .map((item) => item.url.href);

const afterSync = (
  inventory: ReadonlyArray<FeedItemKey>,
  selection: Selection
): ReadonlyArray<string> => [
  ...selection.toImport.map((entry) => entry.url.href),
  ...keptUrls(inventory, selection),
];

const select = (
  inventoryLetters: ReadonlyArray<string>,
  sourceLetters: ReadonlyArray<string>,
  retention = 3
) => {
  const inventory = inventoryOf(inventoryLetters);
  const selection = selectItems(inventory, entriesOf(sourceLetters), retention);

  return { inventory, selection };
};

const expected = (letters: ReadonlyArray<string>): ReadonlyArray<string> =>
  letters.map((letter) => `${base}/${letter}`);

describe('selectItems on a fresh feed', () => {
  it('imports the first N entries of a new feed, newest first', () => {
    const { inventory, selection } = select([], ['d', 'c', 'b', 'a']);

    expect(afterSync(inventory, selection)).toEqual(expected(['d', 'c', 'b']));
    expect(selection.toRemove).toEqual([]);
  });
});

describe('selectItems with new entries', () => {
  it('puts a new entry on top and removes the oldest', () => {
    const { inventory, selection } = select(
      ['d', 'c', 'b'],
      ['e', 'd', 'c', 'b']
    );

    expect(selection.toImport.map((entry) => entry.url.href)).toEqual(
      expected(['e'])
    );
    expect(afterSync(inventory, selection)).toEqual(expected(['e', 'd', 'c']));
  });

  it('imports an entry inserted in the middle and drops the last one', () => {
    const { inventory, selection } = select(
      ['e', 'd', 'c'],
      ['e', 'x', 'd', 'c']
    );

    expect(afterSync(inventory, selection)).toEqual(expected(['x', 'e', 'd']));
  });
});

describe('selectItems with a shorter source', () => {
  it('keeps stored entries up to N', () => {
    const { inventory, selection } = select(['e', 'd', 'c'], ['f']);

    expect(afterSync(inventory, selection)).toEqual(expected(['f', 'e', 'd']));
  });
});

describe('selectItems with a reordered source', () => {
  it('does not move stored entries', () => {
    const { inventory, selection } = select(['e', 'd', 'c'], ['c', 'e', 'd']);

    expect(selection.toImport).toEqual([]);
    expect(afterSync(inventory, selection)).toEqual(expected(['e', 'd', 'c']));
  });
});

describe('selectItems after a retention change', () => {
  it('reimports an entry brought back by a higher retention', () => {
    const { inventory, selection } = select(
      ['e', 'd', 'c'],
      ['e', 'd', 'c', 'b'],
      4
    );

    expect(afterSync(inventory, selection)).toEqual(
      expected(['b', 'e', 'd', 'c'])
    );
  });
});

describe('selectItems with an edited entry', () => {
  it('never touches the stored item', () => {
    const inventory = inventoryOf(['x']);
    const selection = selectItems(
      inventory,
      [parsedEntry(`${base}/x`, { title: 'A new title' })],
      3
    );

    expect(selection.toImport).toEqual([]);
    expect(selection.toRemove).toEqual([]);
  });
});

describe('selectItems duplicate URLs', () => {
  it('collapses a URL to its first entry in source order', () => {
    const selection = selectItems(
      inventoryOf([]),
      [
        parsedEntry(`${base}/a`, { title: 'First a' }),
        parsedEntry(`${base}/a`, { title: 'Second a' }),
        parsedEntry(`${base}/b`),
        parsedEntry(`${base}/a`),
      ],
      3
    );

    expect(
      selection.toImport.map((entry) => [entry.url.href, entry.title])
    ).toEqual([
      [`${base}/a`, 'First a'],
      [`${base}/b`, 'Entry'],
    ]);
  });
});

describe('selectItems beyond the retention', () => {
  it('never imports an entry beyond the first N distinct ones', () => {
    const { inventory, selection } = select(
      ['d'],
      ['a', 'b', 'c', 'd', 'e'],
      3
    );

    expect(selection.toImport.map((entry) => entry.url.href)).toEqual(
      expected(['a', 'b', 'c'])
    );
    expect(selection.toRemove).toHaveLength(inventory.length);
  });

  it('imports nothing from an empty source', () => {
    const { selection } = select(['a'], []);

    expect(selection.toImport).toEqual([]);
    expect(selection.toRemove).toEqual([]);
  });
});
