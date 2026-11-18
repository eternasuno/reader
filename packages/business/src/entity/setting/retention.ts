import { Effect, Schema } from 'effect';

/**
 * N, the number of items a feed keeps (FD-SEL): any integer of at least 1,
 * default 100. The range and the default belong to the value, not to an
 * operation or to a deployment (SET-VAL-1, SET-VAL-5).
 */
export const Retention = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1)),
  Schema.withDecodingDefaultType(Effect.succeed(100)),
  Schema.brand('Retention')
);

export type Retention = typeof Retention.Type;
