import { expect } from '@effect/vitest';
import type { ParsedFeedEntry } from '@reader/business';
import { DateTime, Option } from 'effect';

export const base = new URL('https://example.com/feed.xml');

const field = <A>(
  entry: ParsedFeedEntry | undefined,
  select: (entry: ParsedFeedEntry) => Option.Option<A>
) => Option.flatMap(Option.fromUndefinedOr(entry), select);

export const isoOf = (entry: ParsedFeedEntry | undefined) =>
  Option.match(
    field(entry, (item) => item.publishedAt),
    {
      onNone: () => undefined,
      onSome: DateTime.formatIso,
    }
  );

export const expectOptional = <A>(
  entry: ParsedFeedEntry | undefined,
  select: (entry: ParsedFeedEntry) => Option.Option<A>,
  expected: Option.Option<A>
) => expect(field(entry, select)).toEqual(expected);

export const expectDescription = (
  entry: ParsedFeedEntry | undefined,
  value: string
) => expectOptional(entry, (item) => item.description, Option.some(value));

export const expectContent = (
  entry: ParsedFeedEntry | undefined,
  value: string
) => expectOptional(entry, (item) => item.content, Option.some(value));

export const expectNoPublishedAt = (entry: ParsedFeedEntry | undefined) =>
  expectOptional(entry, (item) => item.publishedAt, Option.none());

export const expectLink = (entry: ParsedFeedEntry | undefined, value: string) =>
  expect(entry?.url.href).toBe(value);

export const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>News</title>
    <description>Daily</description>
    <item>
      <title>First</title>
      <link>https://example.com/a</link>
      <pubDate>Wed, 01 Jan 2026 00:00:00 GMT</pubDate>
      <description>Summary</description>
      <content:encoded><![CDATA[<p>Body</p>]]></content:encoded>
    </item>
    <item>
      <title>Relative</title>
      <link>/b</link>
    </item>
    <item>
      <title>Ftp</title>
      <link>ftp://example.com/file</link>
    </item>
    <item>
      <title>Script</title>
      <link>javascript:alert(1)</link>
    </item>
    <item>
      <title>Blank</title>
      <link>   </link>
    </item>
    <item>
      <title>Linkless</title>
    </item>
  </channel>
</rss>`;
