import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type { ParsedFeedEntry } from '../../../../src/entity/feed/feed';
import { DocumentSanitizerError } from '../../../../src/error/common';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { HtmlDocument } from '../../../../src/port/html-parser';
import { refreshFeed } from '../../../../src/usecase/feed/refresh-feed';
import {
  alice,
  makeUniqueFeed,
  rowAt,
  updatedTime,
} from '../../../support/fixtures';
import {
  type Doubles,
  defaultSanitize,
  documentText,
  parsedEntry,
  parsedFeed,
  run,
  storedItems,
  urlsOf,
} from '../support';

const importEntries = (
  entries: ReadonlyArray<ParsedFeedEntry>,
  doubles: Doubles = {}
) =>
  run(
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const feed = makeUniqueFeed({ ownerId: alice });

      yield* feeds.create(alice, [feed]);
      yield* refreshFeed(alice, feed.id);

      return yield* storedItems(alice, feed.id);
    }),
    { parseFeed: () => Effect.succeed(parsedFeed({ entries })), ...doubles }
  );

describe('refreshFeed import', () => {
  it.effect(
    'FD-IMPORT-1 an imported item is unread, has no extracted content and carries the entry values',
    () =>
      Effect.gen(function* () {
        const rows = yield* importEntries([
          parsedEntry('https://example.com/a', { title: 'Entry title' }),
        ]);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.title).toBe('Entry title');
        expect(rows[0]?.ownerId).toBe(alice);
        expect(rows[0]?.read).toBe(false);
        expect(Option.isNone(rows[0]?.extractedContent ?? Option.none())).toBe(
          true
        );
        expect(rows[0]?.url.href).toBe('https://example.com/a');
      })
  );
});

describe('refreshFeed import cleaning', () => {
  it.effect(
    'FD-IMPORT-2 description and content are cleaned with the item URL as the base',
    () =>
      Effect.gen(function* () {
        const bases: Array<string> = [];

        const rows = yield* importEntries(
          [
            parsedEntry('https://example.com/post', {
              description: Option.some('<p>raw description</p>'),
              content: Option.some('<p>raw content</p>'),
            }),
          ],
          {
            parseHtml: (html, url) => {
              bases.push(url.href);

              return Effect.succeed(HtmlDocument.make(`clean(${html})`));
            },
          }
        );

        expect(bases).toEqual([
          'https://example.com/post',
          'https://example.com/post',
        ]);
        expect(Option.getOrThrow(rows[0]?.description ?? Option.none())).toBe(
          'clean(<p>raw description</p>)'
        );
        expect(Option.getOrThrow(rows[0]?.content ?? Option.none())).toBe(
          'clean(<p>raw content</p>)'
        );
      })
  );
});

describe('refreshFeed import of text', () => {
  it.effect(
    'FD-IMPORT-3 an absent description and content are stored as none',
    () =>
      Effect.gen(function* () {
        const rows = yield* importEntries([
          parsedEntry('https://example.com/a'),
        ]);
        const row = rowAt(rows, 0);

        expect(rows).toHaveLength(1);
        expect(row.url.href).toBe('https://example.com/a');
        expect(Option.isNone(row.description)).toBe(true);
        expect(Option.isNone(row.content)).toBe(true);
      })
  );

  it.effect('CM-HTML-2 text that is empty after cleaning is none', () =>
    Effect.gen(function* () {
      const rows = yield* importEntries(
        [
          parsedEntry('https://example.com/a', {
            description: Option.some('<p>stripped</p>'),
            content: Option.some('<div>stripped</div>'),
          }),
        ],
        {
          sanitize: () => Effect.succeedNone,
        }
      );
      const row = rowAt(rows, 0);

      expect(rows).toHaveLength(1);
      expect(row.url.href).toBe('https://example.com/a');
      expect(Option.isNone(row.description)).toBe(true);
      expect(Option.isNone(row.content)).toBe(true);
    })
  );
});

describe('refreshFeed import publish time', () => {
  it.effect('FD-IMPORT-5 the publish time the source gives is kept', () =>
    Effect.gen(function* () {
      const rows = yield* importEntries([
        parsedEntry('https://example.com/a', {
          publishedAt: Option.some(updatedTime()),
        }),
      ]);

      const publishedAt = rows[0]?.publishedAt ?? Option.none();

      expect(Option.isSome(publishedAt)).toBe(true);
      expect(Option.getOrThrow(publishedAt).epochMilliseconds).toBe(
        updatedTime().epochMilliseconds
      );
    })
  );
});

describe('refreshFeed import cleaning failures', () => {
  it.effect(
    'FD-IMPORT-6 an entry that cannot be cleaned is skipped and the others are imported',
    () =>
      Effect.gen(function* () {
        const rows = yield* importEntries(
          [
            parsedEntry('https://example.com/bad', {
              description: Option.some('bad'),
            }),
            parsedEntry('https://example.com/good'),
          ],
          {
            sanitize: (document) =>
              documentText(document) === 'bad'
                ? Effect.fail(
                    new DocumentSanitizerError({ message: 'cannot sanitize' })
                  )
                : defaultSanitize(document),
          }
        );

        expect(urlsOf(rows)).toEqual(['https://example.com/good']);
      })
  );
});

describe('refreshFeed import order', () => {
  it.effect(
    'FD-SEL-9 the first listed entry gets the largest id and is on top',
    () =>
      Effect.gen(function* () {
        const rows = yield* importEntries([
          parsedEntry('https://example.com/first'),
          parsedEntry('https://example.com/second'),
          parsedEntry('https://example.com/third'),
        ]);

        expect(urlsOf(rows)).toEqual([
          'https://example.com/first',
          'https://example.com/second',
          'https://example.com/third',
        ]);
      })
  );
});
