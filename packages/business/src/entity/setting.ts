import { Schema } from 'effect';
import { OwnerId, ReaderProvider, Retention } from './object-value';

export const Setting = Schema.Struct({
  ownerId: OwnerId,
  retention: Retention,
  provider: ReaderProvider,
  jinaKey: Schema.optional(Schema.Redacted(Schema.String)),
  browserEndpoint: Schema.String,
});

export type Setting = typeof Setting.Type;
