import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Ref } from 'effect';
import type { Feed } from '../../../src/entity/feed/feed';
import { DocumentSanitizerError } from '../../../src/port/document-sanitizer';
import type {
  ParsedFeed,
  ParsedFeedEntry,
} from '../../../src/port/feed-parser';
import { HtmlParserError } from '../../../src/port/html-parser';
import { refreshFeed } from '../../../src/usecase/feed/refresh-feed';
import { alice, makeUniqueFeed, parsedDocument } from '../../support';
import {
  type Doubles,
  defaultParseHtml,
  defaultSanitize,
  parsedEntry,
  parsedFeed,
  rowAt,
  run,
  storedItems,
  storeFeed,
  urlsOf,
} from './support';

const base = 'https://example.com';

const badHtml = '<p>bad</p>';

const feedOf = (): Feed => makeUniqueFeed({ ownerId: alice });

const refreshOnce = (feed: Feed, parsed: ParsedFeed, doubles: Doubles = {}) =>
  run(
    Effect.gen(function* () {
      yield* storeFeed(feed);
      yield* refreshFeed(alice, feed.id);

      return yield* storedItems(alice, feed.id);
    }),
    { ...doubles, parseFeed: () => Effect.succeed(parsed) }
  );

const retryEntries = (): ReadonlyArray<ParsedFeedEntry> => [
  parsedEntry(`${base}/a`, { description: Option.some(badHtml) }),
  parsedEntry(`${base}/b`, { title: 'B' }),
];

const retryScenario = (feed: Feed, failing: Ref.Ref<boolean>) =>
  run(
    Effect.gen(function* () {
      yield* storeFeed(feed);
      yield* refreshFeed(alice, feed.id);
      const afterFirst = yield* storedItems(alice, feed.id);

      yield* Ref.set(failing, false);
      yield* refreshFeed(alice, feed.id);

      return { afterFirst, afterSecond: yield* storedItems(alice, feed.id) };
    }),
    {
      parseFeed: () =>
        Effect.succeed(
          parsedFeed({ title: 'Source title', entries: retryEntries() })
        ),
      parseHtml: (html) =>
        Effect.gen(function* () {
          if (html === badHtml && (yield* Ref.get(failing))) {
            return yield* new HtmlParserError({ message: 'bad markup' });
          }

          return parsedDocument(html);
        }),
    }
  );

describe('refreshFeed cleaning failures', () => {
  it.effect(
    'skips only the entry that cannot be cleaned, retrying it later',
    () =>
      Effect.gen(function* () {
        const result = yield* retryScenario(feedOf(), yield* Ref.make(true));

        expect(urlsOf(result.afterFirst)).toEqual([`${base}/b`]);
        expect(urlsOf(result.afterSecond)).toEqual([`${base}/a`, `${base}/b`]);
        expect(
          Option.getOrThrow(rowAt(result.afterSecond, 0).description)
        ).toBe(badHtml);
      })
  );

  it.effect('turns a sanitizer failure into a skipped entry', () =>
    Effect.gen(function* () {
      const items = yield* refreshOnce(
        feedOf(),
        parsedFeed({
          entries: [
            parsedEntry(`${base}/a`, { content: Option.some(badHtml) }),
          ],
        }),
        {
          sanitize: () =>
            Effect.fail(new DocumentSanitizerError({ message: 'sanitize' })),
        }
      );

      expect(items).toEqual([]);
    })
  );
});

describe('refreshFeed sanitized text', () => {
  it.effect('trims the sanitized text', () =>
    Effect.gen(function* () {
      const items = yield* refreshOnce(
        feedOf(),
        parsedFeed({
          entries: [
            parsedEntry(`${base}/a`, { description: Option.some('<p>x</p>') }),
          ],
        }),
        { sanitize: () => Effect.succeedSome('  <p>x</p>  ') }
      );

      expect(Option.getOrThrow(rowAt(items, 0).description)).toBe('<p>x</p>');
    })
  );

  it.effect('turns a blank sanitized text into none', () =>
    Effect.gen(function* () {
      const parsed = parsedFeed({
        entries: [
          parsedEntry(`${base}/a`, { description: Option.some('<p>x</p>') }),
        ],
      });
      const blank = yield* refreshOnce(feedOf(), parsed, {
        sanitize: () => Effect.succeedSome('   '),
      });
      const empty = yield* refreshOnce(feedOf(), parsed, {
        sanitize: () => Effect.succeedNone,
      });

      expect(Option.isNone(rowAt(blank, 0).description)).toBe(true);
      expect(Option.isNone(rowAt(empty, 0).description)).toBe(true);
    })
  );
});

describe('refreshFeed absent text', () => {
  it.effect('returns none without using the cleaning ports', () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const count = <A, E, R>(
        effect: Effect.Effect<A, E, R>
      ): Effect.Effect<A, E, R> =>
        Ref.update(calls, (total) => total + 1).pipe(
          Effect.flatMap(() => effect)
        );
      const items = yield* refreshOnce(
        feedOf(),
        parsedFeed({ entries: [parsedEntry(`${base}/a`)] }),
        {
          parseHtml: (html, url) => count(defaultParseHtml(html, url)),
          sanitize: (document) => count(defaultSanitize(document)),
        }
      );
      const item = rowAt(items, 0);

      expect(yield* Ref.get(calls)).toBe(0);
      expect(Option.isNone(item.description)).toBe(true);
      expect(Option.isNone(item.content)).toBe(true);
    })
  );
});
