import { expect } from '@effect/vitest';
import type { ParsedFeedEntry } from '@reader/business';
import { FeedParser } from '@reader/business';
import { DateTime, Effect, Option } from 'effect';
import { FeedParserLive } from '../../src/feed-parser';

export const base = new URL('https://example.com/feed.xml');

/** The source text is parsed through the port, as the refresh parses it. */
export const parseFeed = (text: string, baseUrl: URL = base) =>
  Effect.flatMap(FeedParser, (parser) => parser.parse(text, baseUrl)).pipe(
    Effect.provide(FeedParserLive)
  );

const field = <A>(
  entry: ParsedFeedEntry | undefined,
  select: (entry: ParsedFeedEntry) => Option.Option<A>
): Option.Option<A> => {
  expect(entry).toBeDefined();

  return Option.flatMap(Option.fromUndefinedOr(entry), select);
};

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
