import { Effect, Schema } from 'effect';

export const Retention = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.withDecodingDefaultType(Effect.succeed(100)),
  Schema.brand('Retention')
);

export type Retention = typeof Retention.Type;
