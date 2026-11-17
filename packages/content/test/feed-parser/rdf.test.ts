import { expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  expectContent,
  expectDescription,
  expectLink,
  isoOf,
  parseFeed,
} from '../support/feed-parser';
import { rdf } from '../support/fixtures';

it.effect(
  'FD-PARSE-2 FD-PARSE-6 FD-PARSE-8 maps the RDF channel and items',
  () =>
    Effect.gen(function* () {
      const feed = yield* parseFeed(rdf);

      expect(feed.title).toBe('RDF News');
      expect(feed.description).toEqual(Option.some('RDF daily'));
      expect(feed.entries).toHaveLength(2);

      const [first] = feed.entries;
      expect(first?.title).toBe('R');
      expectLink(first, 'https://example.com/r');
      expectDescription(first, 'rdf summary');
      expectContent(first, '<p>rdf body</p>');
      expect(isoOf(first)).toBe('2026-01-04T00:00:00.000Z');
    })
);

it.effect('FD-PARSE-7 takes the first dc:date of an RDF item', () =>
  Effect.gen(function* () {
    const feed = yield* parseFeed(rdf);

    expect(isoOf(feed.entries[1])).toBe('2026-01-05T00:00:00.000Z');
  })
);
