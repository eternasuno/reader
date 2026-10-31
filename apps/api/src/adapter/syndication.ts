import { DateTime, Effect, Layer, Match } from 'effect';
import { type AnyFeed, parseFeed as parseSyndication } from 'feedsmith';
import {
  FetchSubscriptionError,
  ParseSubscriptionError,
  type SubscriptionEntry,
  type SyndicatedFeed,
  Syndication,
} from '../../../../packages/business/src/port/syndication.ts';
import { fetchFeed } from '../infrastructure/feed-fetch';

const MAX_TITLE_LENGTH = 500;

const MAX_FIELD_LENGTH = 100_000;

const UNSUPPORTED_DECLARATION = /<!DOCTYPE|<!ENTITY/i;

type RawEntry = {
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly content: string | undefined;
  readonly descriptionText: boolean;
  readonly contentText: boolean;
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

const mediaType = (type: string | undefined) =>
  type?.split(';')[0]?.trim().toLowerCase() ?? '';

const isPlainMediaType = (type: string | undefined) =>
  PLAIN_MEDIA_TYPES.has(mediaType(type));

const isHtmlMediaType = (type: string | undefined) =>
  HTML_MEDIA_TYPES.has(mediaType(type));

const rssEntry = (item: RssItem): RawEntry => ({
  title: item.title,
  description: item.description,
  content: item.content?.encoded,
  descriptionText: false,
  contentText: false,
  url: item.link,
  date: item.pubDate,
});

const rdfEntry = (item: RdfItem): RawEntry => ({
  title: item.title,
  description: item.description,
  content: item.content?.encoded,
  descriptionText: false,
  contentText: false,
  url: item.link,
  date: item.dc?.dates?.[0],
});

const atomText = (value: string | undefined, type: string | undefined) =>
  isPlainMediaType(type) || isHtmlMediaType(type) ? value : undefined;

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
  descriptionText: isPlainMediaType(item.summary?.type),
  contentText: isPlainMediaType(item.content?.type),
  url: atomUrl(item.links),
  date: item.published,
});

const jsonEntry = (item: JsonItem): RawEntry => ({
  title: item.title,
  description: item.summary,
  content: item.content_html ?? item.content_text,
  descriptionText: true,
  contentText: item.content_html === undefined,
  url: item.url,
  date: item.date_published,
});

const rawEntries = (parsed: AnyFeed): readonly RawEntry[] =>
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

const toUrl = (value: string | undefined, base: string): URL | undefined => {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  try {
    const url = new URL(value, base);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return undefined;
    }

    return url;
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
  title?.trim().slice(0, MAX_TITLE_LENGTH) || 'Untitled';

const toEntry = (item: RawEntry, base: string): SubscriptionEntry => {
  const url = toUrl(item.url, base);
  const publishedAt = toPublishedAt(item.date);
  const description = item.description?.slice(0, MAX_FIELD_LENGTH);
  const content = item.content?.slice(0, MAX_FIELD_LENGTH);

  return {
    title: cleanTitle(item.title),
    descriptionText: item.descriptionText,
    contentText: item.contentText,
    ...(url === undefined ? {} : { url }),
    ...(description === undefined ? {} : { description }),
    ...(content === undefined ? {} : { content }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
};

const feedTitle = (parsed: AnyFeed) => {
  const title =
    parsed.format === 'atom' ? parsed.feed.title?.value : parsed.feed.title;

  return cleanTitle(title);
};

const feedDescription = (parsed: AnyFeed) => {
  const description =
    parsed.format === 'atom'
      ? parsed.feed.subtitle?.value
      : parsed.feed.description;

  return description?.slice(0, MAX_TITLE_LENGTH);
};

const feedEntries = (parsed: AnyFeed, base: string) =>
  rawEntries(parsed).map((item) => toEntry(item, base));

export const parseSubscriptionFeed = (
  content: string,
  base: string
): SyndicatedFeed => {
  if (UNSUPPORTED_DECLARATION.test(content)) {
    throw new Error('Unsupported XML declarations');
  }

  const parsed = parseSyndication(content);
  const description = feedDescription(parsed);

  return {
    title: feedTitle(parsed),
    ...(description === undefined ? {} : { description }),
    articles: feedEntries(parsed, base),
  };
};

export const SyndicationLive = Layer.succeed(Syndication, {
  fetch: (url) =>
    Effect.gen(function* () {
      const document = yield* fetchFeed(url.href).pipe(
        Effect.catchTag('FetchFailure', () =>
          Effect.fail(
            new FetchSubscriptionError({
              message: 'Failed to fetch the subscription feed',
            })
          )
        )
      );

      return yield* Effect.try({
        try: () => parseSubscriptionFeed(document.content, document.url),
        catch: () =>
          new ParseSubscriptionError({
            message: 'Failed to parse the subscription feed',
          }),
      });
    }),
});
