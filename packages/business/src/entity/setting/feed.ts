import { Effect, Schema } from 'effect';

export const Retention = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 30, maximum: 300 })),
  Schema.withDecodingDefaultType(Effect.succeed(100)),
  Schema.brand('Retention')
);

export type Retention = typeof Retention.Type;

export const FeedSetting = Schema.Struct({
  retention: Retention,
});

export type FeedSetting = typeof FeedSetting.Type;
