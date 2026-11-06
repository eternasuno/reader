import { Context, Data, type Effect } from 'effect';
import type { OptionalTrimmedString } from '../entity/object-value';

export class DocumentSantizeError extends Data.TaggedError(
  'DocumentSantizeError'
)<{
  readonly message: string;
}> {}

export interface IDocumentSantize {
  readonly sanitize: (
    document: Document
  ) => Effect.Effect<OptionalTrimmedString, DocumentSantizeError>;
}

export class DocumentSantize extends Context.Service<
  DocumentSantize,
  IDocumentSantize
>()('@reader/business/DocumentSantize') {}
