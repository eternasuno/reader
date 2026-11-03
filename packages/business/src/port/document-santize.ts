import { Context, Data, type Effect } from 'effect';

export class DocumentSantizeError extends Data.TaggedError(
  'DocumentSantizeError'
)<{
  readonly message: string;
}> {}

export interface IDocumentSantize {
  readonly sanitize: (
    document: Document
  ) => Effect.Effect<string, DocumentSantizeError>;
}

export class DocumentSantize extends Context.Service<
  DocumentSantize,
  IDocumentSantize
>()('@reader/business/DocumentSantize') {}
