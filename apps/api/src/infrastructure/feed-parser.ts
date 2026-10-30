import type { ParsedArticle, ParsedFeed } from '@reader/business';
import { type AnyFeed, parseFeed as parseSyndication } from 'feedsmith';
import { JSDOM } from 'jsdom';
import { cleanArticle } from './article-sanitizer';

type ArticleFields = {
  identity?: string | undefined;
  url?: string | undefined;
  title?: string | undefined;
  date?: string | undefined;
  description?: string | undefined;
  text?: boolean | undefined;
};

const normalizeDescription = (item: ArticleFields, base: string) => {
  if (item.description === undefined) {
    return {};
  }

  const dom = new JSDOM('', { url: base });
  try {
    const content = item.description.slice(0, 100000);
    dom.window.document.body.textContent = content;
    cleanArticle(
      dom,
      item.text ? dom.window.document.body.innerHTML : content,
      base
    );
    const description = dom.window.document.body.innerHTML;

    return { description: description.length <= 100000 ? description : '' };
  } finally {
    dom.window.close();
  }
};

const normalizeArticle = (
  item: ArticleFields,
  base: string
): ParsedArticle | undefined => {
  if (!item.url) {
    return undefined;
  }

  try {
    const url = new URL(item.url, base);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return undefined;
    }

    const date = Date.parse(item.date ?? '');

    return {
      identity: item.identity || url.href,
      url: url.href,
      title: item.title?.slice(0, 500) || url.href,
      ...normalizeDescription(item, url.href),
      publishedAt: Number.isNaN(date) ? '' : new Date(date).toISOString(),
    };
  } catch {
    return undefined;
  }
};

const articleFields = (parsed: AnyFeed): ArticleFields[] => {
  switch (parsed.format) {
    case 'rss':
      return (parsed.feed.items ?? []).map((item) => ({
        identity: item.guid?.value,
        url: item.link,
        title: item.title,
        date: item.pubDate ?? item.dc?.dates?.[0],
        description: item.content?.encoded ?? item.description,
      }));
    case 'atom':
      return (parsed.feed.entries ?? []).map((item) => ({
        identity: item.id,
        url: item.links?.find((link) => !link.rel || link.rel === 'alternate')
          ?.href,
        title: item.title?.value,
        date: item.published ?? item.updated,
        description: item.content?.value ?? item.summary?.value,
        text:
          (item.content?.value !== undefined
            ? item.content?.type
            : item.summary?.type) !== 'html' &&
          (item.content?.value !== undefined
            ? item.content?.type
            : item.summary?.type) !== 'xhtml',
      }));
    case 'rdf':
      return (parsed.feed.items ?? []).map((item) => ({
        identity: item.rdf?.about,
        url: item.link,
        title: item.title,
        date: item.dc?.dates?.[0],
        description: item.content?.encoded ?? item.description,
      }));
    case 'json':
      return (parsed.feed.items ?? []).map((item) => ({
        identity: item.id,
        url: item.url ?? item.external_url,
        title: item.title,
        date: item.date_published ?? item.date_modified,
        description: item.content_html ?? item.content_text ?? item.summary,
        text: item.content_html === undefined,
      }));
  }
};

const feedDescription = (parsed: AnyFeed): string | undefined => {
  switch (parsed.format) {
    case 'rss':
      return parsed.feed.description;
    case 'atom':
      return parsed.feed.subtitle?.value;
    case 'rdf':
      return parsed.feed.description;
    case 'json':
      return parsed.feed.description;
  }
};

export const parseFeed = (content: string, base: string): ParsedFeed => {
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) {
    throw new Error('Unsupported XML declarations');
  }

  const parsed = parseSyndication(content);
  const title =
    parsed.format === 'atom' ? parsed.feed.title?.value : parsed.feed.title;
  const description = feedDescription(parsed);
  const articles = articleFields(parsed)
    .map((item) => normalizeArticle(item, base))
    .filter((item): item is ParsedArticle => item !== undefined);
  articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return {
    title: title?.slice(0, 500) || base,
    ...(description === undefined
      ? {}
      : { description: description.slice(0, 500) }),
    articles: articles.slice(0, 500),
  };
};
