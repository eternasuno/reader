import { Schema } from 'effect';

/**
 * The signed-in user a row belongs to. It comes from the session, never from
 * client input (CM-OWN-1). Better Auth owns the value, so it is a plain
 * string.
 */
export const OwnerId = Schema.String.pipe(Schema.brand('OwnerId'));

export type OwnerId = typeof OwnerId.Type;
