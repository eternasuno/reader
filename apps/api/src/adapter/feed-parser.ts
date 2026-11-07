import {
  ArticleTitle,
  FeedParser,
  FeedParserError,
  NormalizedUrl,
  type ParsedFeed,
  ParsedFeedItem,
} from '@reader/business';
import { DateTime, Effect, Layer, Match, Option, Schema } from 'effect';
import { type AnyFeed, parseFeed as parseSyndication } from 'feedsmith';

const MAX_TITLE_LENGTH = 500;

const MAX_FIELD_LENGTH = 100_000;

const UNSUPPORTED_DECLARATION = /<!(?:DOCTYPE|ENTITY)\b/i;

const SKIPPED_XML_MARKUP =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/gi;

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

const hasUnsupportedDeclaration = (content: string) => {
  let index = 0;

  for (const skipped of content.matchAll(SKIPPED_XML_MARKUP)) {
    if (UNSUPPORTED_DECLARATION.test(content.slice(index, skipped.index))) {
      return true;
    }

    index = skipped.index + skipped[0].length;
  }

  return UNSUPPORTED_DECLARATION.test(content.slice(index));
};

const stripByteOrderMark = (content: string) =>
  content.startsWith('\uFEFF') ? content.slice(1) : content;

const isJsonContent = (content: string) => content.trimStart().startsWith('{');

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

const toUrl = (
  value: string | undefined,
  sourceUrl: URL
): string | undefined => {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  try {
    return new URL(value, sourceUrl).href;
  } catch {
    return undefined;
  }
};

const toPublishedAt = (value: string | undefined) => {
  const millis = Date.parse(value ?? '');

  return Number.isNaN(millis)
    ? undefined
    : DateTime.fromDateUnsafe(new Date(millis));
};

const cleanTitle = (title: string | undefined) =>
  Schema.decodeSync(ArticleTitle)(
    (title ?? '').trim().slice(0, MAX_TITLE_LENGTH)
  );

const toEntry = (
  item: RawEntry,
  sourceUrl: URL,
  now: DateTime.Utc
): ParsedFeedItem => {
  const url = toUrl(item.url, sourceUrl);
  const description = item.description?.slice(0, MAX_FIELD_LENGTH);
  const content = item.content?.slice(0, MAX_FIELD_LENGTH);

  return {
    title: cleanTitle(item.title),
    publishedAt: toPublishedAt(item.date) ?? now,
    url:
      url === undefined
        ? Option.none()
        : Schema.decodeOption(NormalizedUrl)(url),
    description: Schema.decodeSync(ParsedFeedItem.fields.description)(
      description
    ),
    content: Schema.decodeSync(ParsedFeedItem.fields.content)(content),
  };
};

const feedTitle = (parsed: AnyFeed) => {
  const title =
    parsed.format === 'atom' ? parsed.feed.title?.value : parsed.feed.title;

  return cleanTitle(title);
};

const feedDescription = (parsed: AnyFeed): Option.Option<string> => {
  const description =
    parsed.format === 'atom'
      ? parsed.feed.subtitle?.value
      : parsed.feed.description;

  return Option.fromUndefinedOr(description?.slice(0, MAX_TITLE_LENGTH));
};

const feedEntries = (parsed: AnyFeed, sourceUrl: URL, now: DateTime.Utc) =>
  rawEntries(parsed).map((item) => toEntry(item, sourceUrl, now));

export const parseFeed = (
  content: string,
  sourceUrl: URL,
  now: DateTime.Utc
): ParsedFeed => {
  const document = stripByteOrderMark(content);

  if (!isJsonContent(document) && hasUnsupportedDeclaration(document)) {
    throw new Error('Unsupported XML declarations');
  }

  const parsed = parseSyndication(document);
  const description = feedDescription(parsed);

  return {
    title: feedTitle(parsed),
    url: Schema.decodeSync(NormalizedUrl)(sourceUrl.href),
    description,
    items: feedEntries(parsed, sourceUrl, now),
  };
};

const parse = (content: string, sourceUrl: URL) =>
  Effect.flatMap(DateTime.now, (now) =>
    Effect.try({
      try: () => parseFeed(content, sourceUrl, now),
      catch: () =>
        new FeedParserError({
          message: 'Failed to parse the subscription feed',
        }),
    })
  );

export const FeedParserLive = Layer.succeed(FeedParser, { parse });
