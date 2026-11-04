import { Schema } from 'effect';
import { OwnerId } from './object-value';

export const DEFAULT_RETENTION = 100;

export const ReaderProvider = Schema.Literals(['jina', 'browser']);

export type ReaderProvider = typeof ReaderProvider.Type;

export const Retention = Schema.Int.check(
  Schema.isBetween({ minimum: 30, maximum: 300 })
);

export const Setting = Schema.Struct({
  ownerId: OwnerId,
  retention: Retention,
  provider: ReaderProvider,
  jinaKey: Schema.OptionFromOptional(Schema.Redacted(Schema.String)),
  browserEndpoint: Schema.OptionFromOptional(Schema.String),
});

export type Setting = typeof Setting.Type;
