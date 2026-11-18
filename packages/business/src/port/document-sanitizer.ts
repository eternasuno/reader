import { Context, type Effect, type Option } from 'effect';
import type { ArticleContent } from '../entity/common/article';
import type { DocumentSanitizerError } from '../error/common';
import type { HtmlDocument } from './html-parser';

/** Sanitizes a parsed document before its text is stored (CM-HTML step 3). */
export interface IDocumentSanitizer {
  /**
   * The sanitized HTML of the document, or none when nothing is left; text
   * that is empty after cleaning is none (CM-HTML-2, CM-ART-5). Which tags,
   * attributes and URLs survive is the adapter's decision (CM-HTML-3), and the
   * result is stored article content (CM-ART-4). A failure is
   * `DocumentSanitizerError`; the refresh then skips the entry (CM-HTML-4,
   * FD-IMPORT-6).
   */
  readonly sanitize: (
    document: HtmlDocument
  ) => Effect.Effect<Option.Option<ArticleContent>, DocumentSanitizerError>;
}

export class DocumentSanitizer extends Context.Service<
  DocumentSanitizer,
  IDocumentSanitizer
>()('@reader/business/DocumentSanitizer') {}
