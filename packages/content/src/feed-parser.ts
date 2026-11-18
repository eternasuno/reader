import {
  FeedParser,
  FeedParserError,
  type FeedTitle,
  makeFeedTitle,
  ParsedFeed,
  ParsedFeedEntry,
} from '@reader/business';
import { Array as Arr, Effect, Layer, Match, Option, Schema } from 'effect';
import { type AnyFeed, parseFeed } from 'feedsmith';

type RawEntry = {
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly content: string | undefined;
  readonly url: string | undefined;
  readonly date: string | undefined;
};

type RssItem = NonNullable<
  Extract<AnyFeed, { format: 'rss' }>['feed']['items']
>[number];

type RdfItem = NonNullable<
  Extract<AnyFeed, { format: 'rdf' }>['feed']['items']
>[number];

type AtomItem = NonNullable<
  Extract<AnyFeed, { format: 'atom' }>['feed']['entries']
>[number];

type JsonItem = NonNullable<
  Extract<AnyFeed, { format: 'json' }>['feed']['items']
>[number];

type AtomLink = NonNullable<AtomItem['links']>[number];

const PLAIN_TYPES = new Set(['', 'text', 'text/plain']);

const HTML_TYPES = new Set([
  'html',
  'text/html',
  'xhtml',
  'application/xhtml+xml',
]);

/** Media types compare trimmed, lower-cased and without parameters (FD-PARSE-3). */
const mediaType = (type: string | undefined) =>
  type?.split(';')[0]?.trim().toLowerCase() ?? '';

/** One leading byte-order mark is removed and nothing else (FD-PARSE-1). */
const withoutByteOrderMark = (text: string) =>
  text.startsWith('\uFEFF') ? text.slice(1) : text;

/** Plain text is escaped once and existing entities are not decoded (FD-PARSE-4). */
const escapeText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const escapeSome = (text: string | undefined) =>
  text === undefined ? undefined : escapeText(text);

const atomText = (text: string | undefined, type: string | undefined) => {
  if (text === undefined) {
    return undefined;
  }

  if (PLAIN_TYPES.has(mediaType(type))) {
    return escapeText(text);
  }

  return HTML_TYPES.has(mediaType(type)) ? text : undefined;
};

/** Content carrying a `src` is not fetched, so it gives none (FD-PARSE-6). */
const atomContent = (content: AtomItem['content']) =>
  content === undefined || content.src !== undefined
    ? undefined
    : atomText(content.value, content.type);

const isAlternate = (link: AtomLink) =>
  link.rel === undefined || link.rel === '' || link.rel === 'alternate';

const atomUrl = (links: AtomItem['links']) => {
  const alternates = (links ?? []).filter(isAlternate);
  const html = alternates.find((link) => mediaType(link.type) === 'text/html');
  const untyped = alternates.find((link) => mediaType(link.type) === '');

  return (html ?? untyped ?? alternates[0])?.href;
};

const rssEntry = (item: RssItem): RawEntry => ({
  title: item.title,
  description: item.description,
  content: item.content?.encoded,
  url: item.link,
  date: item.pubDate,
});

const rdfEntry = (item: RdfItem): RawEntry => ({
  title: item.title,
  description: item.description,
  content: item.content?.encoded,
  url: item.link,
  date: item.dc?.dates?.[0],
});

const atomEntry = (item: AtomItem): RawEntry => ({
  title: item.title?.value,
  description: atomText(item.summary?.value, item.summary?.type),
  content: atomContent(item.content),
  url: atomUrl(item.links),
  date: item.published,
});

const jsonEntry = (item: JsonItem): RawEntry => ({
  title: item.title,
  description: escapeSome(item.summary),
  content:
    item.content_html === undefined || item.content_html.trim() === ''
      ? escapeSome(item.content_text)
      : item.content_html,
  url: item.url,
  date: item.date_published,
});

const rawEntries = (parsed: AnyFeed): ReadonlyArray<RawEntry> =>
  Match.value(parsed).pipe(
    Match.when({ format: 'rss' }, (feed) =>
      (feed.feed.items ?? []).map(rssEntry)
    ),
    Match.when({ format: 'atom' }, (feed) =>
      (feed.feed.entries ?? []).map(atomEntry)
    ),
    Match.when({ format: 'rdf' }, (feed) =>
      (feed.feed.items ?? []).map(rdfEntry)
    ),
    Match.when({ format: 'json' }, (feed) =>
      (feed.feed.items ?? []).map(jsonEntry)
    ),
    Match.exhaustive
  );

/** Defined, non-blank and resolvable, otherwise the entry is dropped (FD-PARSE-2). */
const resolveUrl = (value: string | undefined, baseUrl: URL) => {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
};

/** A missing or unparseable date is undefined, no field falls back (FD-PARSE-7). */
const publishedDate = (value: string | undefined): Date | undefined => {
  const millis = Date.parse(value ?? '');

  return Number.isNaN(millis) ? undefined : new Date(millis);
};

const entryOf = (
  raw: RawEntry,
  baseUrl: URL
): Option.Option<ParsedFeedEntry> => {
  const url = resolveUrl(raw.url, baseUrl);

  return url === undefined
    ? Option.none()
    : Schema.decodeOption(ParsedFeedEntry)({
        title: raw.title ?? '',
        description: raw.description,
        content: raw.content,
        url,
        publishedAt: publishedDate(raw.date),
      });
};

const titleOf = (parsed: AnyFeed, baseUrl: URL): FeedTitle =>
  makeFeedTitle(
    (parsed.format === 'atom' ? parsed.feed.title?.value : parsed.feed.title) ??
      '',
    baseUrl
  );

const descriptionOf = (parsed: AnyFeed): Option.Option<string> =>
  Schema.decodeSync(ParsedFeed.fields.description)(
    parsed.format === 'atom'
      ? parsed.feed.subtitle?.value
      : parsed.feed.description
  );

const readFeed = (text: string, baseUrl: URL): ParsedFeed => {
  const parsed = parseFeed(withoutByteOrderMark(text));

  return {
    title: titleOf(parsed, baseUrl),
    description: descriptionOf(parsed),
    entries: Arr.getSomes(
      rawEntries(parsed).map((raw) => entryOf(raw, baseUrl))
    ),
  };
};

/** A document that is not one of the four formats fails totally (FD-PARSE-1). */
export const parse = Effect.fn('FeedParser.parse')(function* (
  text: string,
  baseUrl: URL
) {
  return yield* Effect.try({
    try: () => readFeed(text, baseUrl),
    catch: () =>
      new FeedParserError({ message: 'Unable to parse the feed document' }),
  });
});

export const FeedParserLive = Layer.succeed(FeedParser, { parse });
