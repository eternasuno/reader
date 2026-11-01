import { Context, Data, type Effect, type Redacted } from 'effect';
import type { ReaderProvider } from '../entity/article';

export class ReaderCredentialsError extends Data.TaggedError(
  'ReaderCredentialsError'
)<{
  readonly error: string;
}> {}

export class ReaderCredentials extends Context.Service<
  ReaderCredentials,
  {
    readonly get: (
      owner: string
    ) => Effect.Effect<
      Redacted.Redacted<string> | undefined,
      ReaderCredentialsError
    >;
    readonly provider: (
      owner: string
    ) => Effect.Effect<ReaderProvider, ReaderCredentialsError>;
    readonly browserEndpoint: (
      owner: string
    ) => Effect.Effect<string | undefined, ReaderCredentialsError>;
  }
>()('ReaderCredentials') {}
