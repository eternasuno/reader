import { Context, Data, type Effect, type Option } from 'effect';

export class DocumentSantizeError extends Data.TaggedError(
  'DocumentSantizeError'
)<{
  readonly message: string;
}> {}

export interface IDocumentSantize {
  readonly sanitize: (
    document: Document
  ) => Effect.Effect<Option.Option<string>, DocumentSantizeError>;
}

export class DocumentSantize extends Context.Service<
  DocumentSantize,
  IDocumentSantize
>()('@reader/business/DocumentSantize') {}
