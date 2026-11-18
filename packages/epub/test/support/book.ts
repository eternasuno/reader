import type { Ebook, EbookChapter } from '@reader/business';
import { ArticleContent, ArticleTitle, NormalizedUrl } from '@reader/business';
import { DateTime, Option, Schema } from 'effect';

export const articleUrl = 'https://example.com/article';

export const titleOf = (title: string) =>
  Schema.decodeSync(ArticleTitle)(title);

export const contentOf = (html: string) =>
  Option.some(Schema.decodeSync(ArticleContent)(html));

/** One chapter with sensible defaults; each test overrides what it covers. */
export const chapterOf = (
  overrides: Partial<EbookChapter> = {}
): EbookChapter => ({
  title: titleOf('An article'),
  source: 'Go Blog',
  url: Schema.decodeSync(NormalizedUrl)(articleUrl),
  publishedAt: Option.none(),
  content: Option.none(),
  ...overrides,
});

export const bookOf = (
  chapters: ReadonlyArray<EbookChapter>,
  title = '留白 2024-01-02',
  images = true
): Ebook => ({
  title,
  createdAt: DateTime.makeUnsafe('2024-01-02T03:04:05Z'),
  chapters,
  images,
});
