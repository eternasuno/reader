import { Context, Data, type Effect, type Option } from 'effect';

export class DocumentSanitizerError extends Data.TaggedError(
  'DocumentSanitizerError'
)<{
  readonly message: string;
}> {}

export interface IDocumentSanitizer {
  readonly sanitize: (
    document: Document
  ) => Effect.Effect<Option.Option<string>, DocumentSanitizerError>;
}

export class DocumentSanitizer extends Context.Service<
  DocumentSanitizer,
  IDocumentSanitizer
>()('@reader/business/DocumentSanitizer') {}
