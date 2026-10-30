import { expect, it } from '@effect/vitest';
import {
  ARTICLE_RETENTION,
  type ParsedArticle,
  type ParsedFeed,
  prepareInitialImport,
  prepareRefreshImport,
} from '../../src';

const now = '2026-10-30T00:00:00.000Z';

const article = (id: number, publishedAt?: string): ParsedArticle => ({
  identity: String(id),
  url: `https://example.com/${id}`,
  title: String(id),
  publishedAt: publishedAt ?? new Date(id * 1000).toISOString(),
});

const newest = (count: number, offset = 0): ParsedArticle[] =>
  Array.from({ length: count }, (_, index) => article(index + offset));

const feed = (articles: ParsedArticle[]): ParsedFeed => ({
  title: 'News',
  articles,
});

it('imports the newest 30 articles when a subscription is created', () => {
  const prepared = prepareInitialImport(feed(newest(35)), now);
  expect(prepared.title).toBe('News');
  expect(prepared.retention).toBe(ARTICLE_RETENTION);
  expect(prepared.articles.map((item) => item.title)).toEqual(
    Array.from({ length: 30 }, (_, index) => String(34 - index))
  );
});

it('imports the newest 500 articles when a subscription is refreshed', () => {
  const prepared = prepareRefreshImport(feed(newest(600)), now);
  expect(prepared.retention).toBe(ARTICLE_RETENTION);
  expect(prepared.articles).toHaveLength(500);
  expect(prepared.articles[0]?.title).toBe('599');
  expect(prepared.articles[499]?.title).toBe('100');
});

it('sorts by publication date and falls back to now for missing dates', () => {
  const prepared = prepareInitialImport(
    feed([
      article(3, '2026-01-01T00:00:00.000Z'),
      article(1, ''),
      article(4, '2027-01-01T00:00:00.000Z'),
      article(2, ''),
    ]),
    now
  );
  expect(prepared.articles.map((item) => item.title)).toEqual([
    '4',
    '3',
    '1',
    '2',
  ]);
  expect(prepared.articles.map((item) => item.publishedAt)).toEqual([
    '2027-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
    now,
    now,
  ]);
});

it('keeps description, identity and url of the selected articles', () => {
  const prepared = prepareRefreshImport(
    feed([{ ...article(1), description: '<p>One</p>' }]),
    now
  );
  expect(prepared.articles).toEqual([
    {
      identity: '1',
      url: 'https://example.com/1',
      title: '1',
      publishedAt: '1970-01-01T00:00:01.000Z',
      description: '<p>One</p>',
    },
  ]);
});
