import { Context, Data, type Effect, type Redacted } from 'effect';
import type { ReaderProvider } from '../entity/article';
import type { OwnerId } from '../entity/model';

export class ExtractionSettingsReadError extends Data.TaggedError(
  'ExtractionSettingsReadError'
)<{
  readonly error: string;
}> {}

export class ExtractionSettingsWriteError extends Data.TaggedError(
  'ExtractionSettingsWriteError'
)<{
  readonly error: string;
}> {}

export type ExtractionSettingsValue = {
  readonly provider: ReaderProvider;
  readonly jinaConfigured: boolean;
  readonly browserEndpoint: string;
};

export type ExtractionSettingsUpdate = {
  readonly provider: ReaderProvider;
  readonly key?: Redacted.Redacted<string>;
  readonly browserEndpoint?: string;
};

export class ExtractionSettings extends Context.Service<
  ExtractionSettings,
  {
    readonly get: (
      owner: OwnerId
    ) => Effect.Effect<ExtractionSettingsValue, ExtractionSettingsReadError>;
    readonly save: (
      owner: OwnerId,
      update: ExtractionSettingsUpdate
    ) => Effect.Effect<void, ExtractionSettingsWriteError>;
    readonly clearKey: (
      owner: OwnerId
    ) => Effect.Effect<void, ExtractionSettingsWriteError>;
    readonly clearBrowser: (
      owner: OwnerId
    ) => Effect.Effect<void, ExtractionSettingsWriteError>;
  }
>()('reader/ExtractionSettings') {}
