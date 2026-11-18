import type { DateTime, Option } from 'effect';
import { Context, type Effect } from 'effect';
import type { ArticleContent, ArticleTitle } from '../entity/common/article';
import type { NormalizedUrl } from '../entity/common/normalized-url';
import type { EpubBuilderError } from '../error/kindle';

/** One article of the book, in reading order (KD-BOOK-2). */
export type EbookChapter = {
  readonly title: ArticleTitle;
  /** The feed title, or `稍后阅读` for a saved page (KD-BOOK-3). */
  readonly source: string;
  readonly url: NormalizedUrl;
  readonly publishedAt: Option.Option<DateTime.Utc>;
  /** Sanitized HTML (CM-ART-4); none gives a chapter with the heading only. */
  readonly content: Option.Option<ArticleContent>;
};

/** The book one send mails (KD-BOOK-1). */
export type Ebook = {
  readonly title: string;
  readonly createdAt: DateTime.Utc;
  readonly chapters: ReadonlyArray<EbookChapter>;
  /**
   * `false` builds the text only: no image is downloaded and every image is
   * removed, for an article too large with its images (KD-SPLIT-3).
   */
  readonly images: boolean;
};

/**
 * Builds an EPUB 3 file (KD-BOOK). The adapter turns each chapter's HTML into
 * XHTML, downloads the images it references and embeds them; an image that
 * cannot be fetched, or is not JPEG, PNG or GIF, is dropped from its chapter
 * and never fails the book (KD-BOOK-4).
 */
export interface IEpubBuilder {
  readonly build: (book: Ebook) => Effect.Effect<Uint8Array, EpubBuilderError>;
}

export class EpubBuilder extends Context.Service<EpubBuilder, IEpubBuilder>()(
  '@reader/business/EpubBuilder'
) {}
