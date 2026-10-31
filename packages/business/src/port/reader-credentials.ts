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
    readonly set: (
      owner: string,
      key: Redacted.Redacted<string>
    ) => Effect.Effect<void, ReaderCredentialsError>;
    readonly remove: (
      owner: string
    ) => Effect.Effect<void, ReaderCredentialsError>;
    readonly configured: (
      owner: string
    ) => Effect.Effect<boolean, ReaderCredentialsError>;
    readonly provider: (
      owner: string
    ) => Effect.Effect<ReaderProvider, ReaderCredentialsError>;
    readonly setProvider: (
      owner: string,
      provider: ReaderProvider
    ) => Effect.Effect<void, ReaderCredentialsError>;
    readonly browserEndpoint: (
      owner: string
    ) => Effect.Effect<string | undefined, ReaderCredentialsError>;
    readonly setBrowserEndpoint: (
      owner: string,
      endpoint: string
    ) => Effect.Effect<void, ReaderCredentialsError>;
  }
>()('ReaderCredentials') {}
