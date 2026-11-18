import { Effect, Option } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
} from '../../../entity/common/article';
import type { NormalizedUrl } from '../../../entity/common/normalized-url';
import type { Feed, ParsedFeedEntry } from '../../../entity/feed/feed';
import { FeedItem } from '../../../entity/feed-item/feed-item';
import type {
  DocumentSanitizerError,
  HtmlParserError,
} from '../../../error/common';
import { DocumentSanitizer } from '../../../port/document-sanitizer';
import { HtmlParser } from '../../../port/html-parser';

type CleanedText = {
  readonly description: Option.Option<string>;
  readonly content: Option.Option<string>;
};

/**
 * Cleans one text of an entry (CM-HTML): it is parsed against the entry's URL,
 * which resolves relative links, and sanitized. The document lives in a scope
 * that ends with the sanitizing step. Absent text is none (CM-HTML step 1).
 */
const cleanText = Effect.fnUntraced(function* (
  text: Option.Option<string>,
  url: NormalizedUrl
): Effect.fn.Return<
  Option.Option<string>,
  HtmlParserError | DocumentSanitizerError,
  HtmlParser | DocumentSanitizer
> {
  if (Option.isNone(text)) {
    return Option.none<string>();
  }

  const parser = yield* HtmlParser;
  const sanitizer = yield* DocumentSanitizer;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const document = yield* parser.parse(text.value, url);

      return yield* sanitizer.sanitize(document);
    })
  );
});

const cleanFields = Effect.fnUntraced(function* (
  entry: ParsedFeedEntry
): Effect.fn.Return<
  CleanedText,
  HtmlParserError | DocumentSanitizerError,
  HtmlParser | DocumentSanitizer
> {
  const description = yield* cleanText(entry.description, entry.url);
  const content = yield* cleanText(entry.content, entry.url);

  return { description, content };
});

/**
 * The cleaned text of one entry, or none when it cannot be cleaned: that entry
 * is skipped and logged, so one bad entry never blocks a feed (FD-IMPORT-6).
 */
const cleanEntry = Effect.fnUntraced(function* (
  entry: ParsedFeedEntry
): Effect.fn.Return<
  Option.Option<CleanedText>,
  never,
  HtmlParser | DocumentSanitizer
> {
  return yield* cleanFields(entry).pipe(
    Effect.asSome,
    Effect.catch((error) =>
      Effect.logWarning(
        'Skipping a feed entry that cannot be cleaned',
        entry.url.href,
        error
      ).pipe(Effect.as(Option.none<CleanedText>()))
    )
  );
});

/** A new item for an entry: unread, no extracted content, the entry's values (FD-IMPORT-1). */
const buildItem = Effect.fnUntraced(function* (
  feed: Feed,
  entry: ParsedFeedEntry,
  cleaned: CleanedText
): Effect.fn.Return<FeedItem> {
  return yield* FeedItem.makeEffect({
    ownerId: feed.ownerId,
    feedId: feed.id,
    url: entry.url,
    title: entry.title,
    description: Option.map(cleaned.description, (text) =>
      ArticleDescription.make(text)
    ),
    content: Option.map(cleaned.content, (text) => ArticleContent.make(text)),
    extractedContent: Option.none(),
    publishedAt: entry.publishedAt,
    read: false,
  }).pipe(Effect.orDie);
});

/**
 * Builds the items of the entries to import, from the last listed entry to the
 * first, so the first listed entry gets the largest id and is on top
 * (FD-SEL-9). An entry that cannot be cleaned is skipped (FD-IMPORT-6).
 */
export const buildEntries = Effect.fnUntraced(function* (
  feed: Feed,
  entries: ReadonlyArray<ParsedFeedEntry>
): Effect.fn.Return<
  ReadonlyArray<FeedItem>,
  never,
  HtmlParser | DocumentSanitizer
> {
  const built: Array<FeedItem> = [];

  for (const entry of Array.from(entries).reverse()) {
    const cleaned = yield* cleanEntry(entry);

    if (Option.isSome(cleaned)) {
      built.push(yield* buildItem(feed, entry, cleaned.value));
    }
  }

  return built;
});
