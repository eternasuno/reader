import { expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { parseFeed } from '../../../src/content/feed-parser';
import {
  base,
  expectContent,
  expectDescription,
  expectNoPublishedAt,
  isoOf,
} from '../../support/feed-parser';

it('FD-PARSE-7 uses only date_published for JSON Feed dates', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON Dates',
    items: [
      {
        id: '1',
        url: 'https://example.com/modified',
        title: 'Modified',
        date_modified: '2026-01-09T00:00:00Z',
      },
      {
        id: '2',
        url: 'https://example.com/published',
        title: 'Published',
        date_published: '2026-01-10T00:00:00Z',
        date_modified: '2026-01-11T00:00:00Z',
      },
    ],
  });
  const feed = parseFeed(json, base);
  expectNoPublishedAt(feed.entries[0]);
  expect(isoOf(feed.entries[1])).toBe('2026-01-10T00:00:00.000Z');
});

it('FD-PARSE-2 FD-PARSE-5 FD-PARSE-8 maps JSON Feed items without using external_url', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON News',
    description: 'J',
    items: [
      {
        id: '1',
        url: 'https://example.com/j',
        title: 'J1',
        summary: 'sum',
        content_text: 'body',
        date_published: '2026-01-03T00:00:00Z',
      },
      {
        id: '2',
        external_url: 'https://example.com/external',
        title: 'J2',
        content_html: '<p>rich</p>',
      },
    ],
  });
  const feed = parseFeed(json, base);
  expect(feed.title).toBe('JSON News');
  expect(feed.description).toEqual(Option.some('J'));
  expect(feed.entries).toHaveLength(1);
  expect(feed.entries[0]?.title).toBe('J1');
  expectDescription(feed.entries[0], 'sum');
  expectContent(feed.entries[0], 'body');
  expect(isoOf(feed.entries[0])).toBe('2026-01-03T00:00:00.000Z');
});

it('FD-PARSE-5 falls back to content_text when content_html is blank', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON News',
    items: [
      {
        id: '1',
        url: 'https://example.com/j',
        title: 'J1',
        content_html: '',
        content_text: 'Plain',
      },
      {
        id: '2',
        url: 'https://example.com/k',
        title: 'J2',
        content_html: '   ',
        content_text: 'Spaced',
      },
    ],
  });
  const feed = parseFeed(json, base);
  expectContent(feed.entries[0], 'Plain');
  expectContent(feed.entries[1], 'Spaced');
});
