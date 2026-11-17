import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  expectContent,
  expectDescription,
  expectLink,
  expectNoPublishedAt,
  isoOf,
  parseFeed,
} from '../support/feed-parser';
import { jsonFeed } from '../support/fixtures';

it.effect(
  'FD-PARSE-2 FD-PARSE-8 reads JSON Feed items, ignoring external_url',
  () =>
    Effect.gen(function* () {
      const feed = yield* parseFeed(jsonFeed);

      expect(feed.title).toBe('JSON News');
      expect(feed.description).toEqual(Option.some('J'));
      expect(feed.entries.map((entry) => entry.title)).toEqual(['J1', 'J3']);

      const [first] = feed.entries;
      expectLink(first, 'https://example.com/j1');
      expectDescription(first, 'sum');
      expectContent(first, 'body');
      expect(isoOf(first)).toBe('2026-01-03T00:00:00.000Z');
    })
);

it.effect('FD-PARSE-5 prefers content_html and falls back to plain text', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Contents',
        items: [
          {
            id: '1',
            url: 'https://example.com/rich',
            title: 'Rich',
            content_html: '<p>rich</p>',
            content_text: 'plain',
          },
          {
            id: '2',
            url: 'https://example.com/blank',
            title: 'Blank',
            content_html: '   ',
            content_text: '<b>plain</b>',
          },
        ],
      })
    );

    expectContent(feed.entries[0], '<p>rich</p>');
    expectContent(feed.entries[1], '&lt;b&gt;plain&lt;/b&gt;');
  })
);

it.effect('FD-PARSE-7 uses only date_published for JSON Feed times', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(jsonFeed);

    expect(isoOf(feed.entries[0])).toBe('2026-01-03T00:00:00.000Z');
    expectNoPublishedAt(feed.entries[1]);
  })
);

it.effect('FD-PARSE-2 drops a JSON Feed item without a url', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Missing',
        items: [
          {
            id: '1',
            external_url: 'https://example.com/external',
            title: 'No',
          },
          { id: '2', url: '   ', title: 'Blank' },
          { id: '3', url: 'https://example.com/yes', title: 'Yes' },
        ],
      })
    );

    expect(feed.entries.map((entry) => entry.title)).toEqual(['Yes']);
  })
);
