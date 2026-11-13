import { expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { parseFeed } from '../../../src/content/feed-parser';
import { base, expectDescription, isoOf } from '../../support/feed-parser';

it('FD-PARSE-7 FD-PARSE-8 maps RDF items to raw entries', () => {
  const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel rdf:about="https://example.com/">
      <title>RDF News</title>
      <link>https://example.com/</link>
      <description>RDF daily</description>
    </channel>
    <item rdf:about="https://example.com/r">
      <title>R</title>
      <link>https://example.com/r</link>
      <dc:date>2026-01-04T00:00:00Z</dc:date>
      <description>rdf summary</description>
    </item>
  </rdf:RDF>`;
  const feed = parseFeed(rdf, base);
  expect(feed.title).toBe('RDF News');
  expect(feed.description).toEqual(Option.some('RDF daily'));
  expect(feed.entries[0]?.title).toBe('R');
  expectDescription(feed.entries[0], 'rdf summary');
  expect(isoOf(feed.entries[0])).toBe('2026-01-04T00:00:00.000Z');
});

it('FD-PARSE-7 takes the first dc:date of an RDF item', () => {
  const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel rdf:about="https://example.com/">
      <title>RDF Dates</title>
    </channel>
    <item rdf:about="https://example.com/two-dates">
      <title>Two dates</title>
      <link>https://example.com/two-dates</link>
      <dc:date>2026-01-12T00:00:00Z</dc:date>
      <dc:date>2026-01-13T00:00:00Z</dc:date>
    </item>
  </rdf:RDF>`;
  const [entry] = parseFeed(rdf, base).entries;
  expect(entry?.title).toBe('Two dates');
  expect(isoOf(entry)).toBe('2026-01-12T00:00:00.000Z');
});
