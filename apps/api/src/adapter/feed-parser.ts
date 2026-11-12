import {
  ArticleTitle,
  FeedParser,
  FeedParserError,
  type FeedTitle,
  makeFeedTitle,
  NormalizedUrl,
  ParsedFeed,
  ParsedFeedEntry,
} from '@reader/business';
import {
  Array as Arr,
  DateTime,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from 'effect';
import { type AnyFeed, parseFeed as parseSyndication } from 'feedsmith';

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

const PLAIN_MEDIA_TYPES = new Set(['', 'text', 'text/plain']);

const HTML_MEDIA_TYPES = new Set([
  'html',
  'text/html',
  'xhtml',
  'application/xhtml+xml',
]);

const stripByteOrderMark = (content: string) =>
  content.startsWith('\uFEFF') ? content.slice(1) : content;

const mediaType = (type: string | undefined) =>
  type?.split(';')[0]?.trim().toLowerCase() ?? '';

const isPlainMediaType = (type: string | undefined) =>
  PLAIN_MEDIA_TYPES.has(mediaType(type));

const isHtmlMediaType = (type: string | undefined) =>
  HTML_MEDIA_TYPES.has(mediaType(type));

const escapeText = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

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

const atomText = (value: string | undefined, type: string | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  if (isPlainMediaType(type)) {
    return escapeText(value);
  }

  return isHtmlMediaType(type) ? value : undefined;
};

const atomContent = (content: AtomItem['content']) =>
  content === undefined || content.src !== undefined
    ? undefined
    : atomText(content.value, content.type);

const isAlternateLink = (link: AtomLink) =>
  !link.rel || link.rel === 'alternate';

const atomUrl = (links: AtomItem['links']) => {
  const alternates = (links ?? []).filter(isAlternateLink);
  const preferred = alternates.find(
    (link) => mediaType(link.type) === 'text/html'
  );
  const untyped = alternates.find((link) => mediaType(link.type) === '');

  return (preferred ?? untyped ?? alternates[0])?.href;
};

const atomEntry = (item: AtomItem): RawEntry => ({
  title: item.title?.value,
  description: atomText(item.summary?.value, item.summary?.type),
  content: atomContent(item.content),
  url: atomUrl(item.links),
  date: item.published,
});

const jsonEntry = (item: JsonItem): RawEntry => ({
  title: item.title,
  description:
    item.summary === undefined ? undefined : escapeText(item.summary),
  content:
    item.content_html ??
    (item.content_text === undefined
      ? undefined
      : escapeText(item.content_text)),
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

const resolveUrl = (value: string, baseUrl: URL): string | undefined => {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
};

const entryUrl = (
  value: string | undefined,
  baseUrl: URL
): Option.Option<NormalizedUrl> => {
  if (value === undefined || value.trim() === '') {
    return Option.none();
  }

  const resolved = resolveUrl(value, baseUrl);

  return resolved === undefined
    ? Option.none()
    : Schema.decodeOption(NormalizedUrl)(resolved);
};

const toPublishedAt = (
  value: string | undefined
): Option.Option<DateTime.Utc> => {
  const millis = Date.parse(value ?? '');

  return Number.isNaN(millis)
    ? Option.none()
    : Option.some(DateTime.fromDateUnsafe(new Date(millis)));
};

const cleanTitle = (title: string | undefined) =>
  Schema.decodeSync(ArticleTitle)((title ?? '').trim());

const toEntry = (
  item: RawEntry,
  baseUrl: URL
): Option.Option<ParsedFeedEntry> =>
  Option.map(entryUrl(item.url, baseUrl), (url) => ({
    title: cleanTitle(item.title),
    url,
    publishedAt: toPublishedAt(item.date),
    description: Schema.decodeSync(ParsedFeedEntry.fields.description)(
      item.description
    ),
    content: Schema.decodeSync(ParsedFeedEntry.fields.content)(item.content),
  }));

const feedTitle = (parsed: AnyFeed, baseUrl: URL): FeedTitle => {
  const title =
    parsed.format === 'atom' ? parsed.feed.title?.value : parsed.feed.title;

  return makeFeedTitle(title ?? '', baseUrl);
};

const feedDescription = (parsed: AnyFeed): Option.Option<string> => {
  const description =
    parsed.format === 'atom'
      ? parsed.feed.subtitle?.value
      : parsed.feed.description;

  return Schema.decodeSync(ParsedFeed.fields.description)(description);
};

const feedEntries = (
  parsed: AnyFeed,
  baseUrl: URL
): ReadonlyArray<ParsedFeedEntry> =>
  Arr.getSomes(rawEntries(parsed).map((item) => toEntry(item, baseUrl)));

export const parseFeed = (content: string, baseUrl: URL): ParsedFeed => {
  const parsed = parseSyndication(stripByteOrderMark(content));

  return {
    title: feedTitle(parsed, baseUrl),
    description: feedDescription(parsed),
    entries: feedEntries(parsed, baseUrl),
  };
};

const parse = (content: string, baseUrl: URL) =>
  Effect.try({
    try: () => parseFeed(content, baseUrl),
    catch: () =>
      new FeedParserError({
        message: 'Failed to parse the subscription feed',
      }),
  });

export const FeedParserLive = Layer.succeed(FeedParser, { parse });
