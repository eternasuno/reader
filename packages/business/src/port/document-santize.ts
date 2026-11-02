import { Context, type Effect, Schema } from 'effect';

export class DocumentSantizeError extends Schema.TaggedError<DocumentSantizeError>()(
  'DocumentSantizeError',
  { message: Schema.String }
) {}

export interface IDocumentSantize {
  readonly sanitize: (
    document: Document
  ) => Effect.Effect<string, DocumentSantizeError>;
}

export class DocumentSantize extends Context.Service<
  DocumentSantize,
  IDocumentSantize
>()('@reader/business/DocumentSantize') {}
