import { Schema } from 'effect';

export const OwnerId = Schema.String.pipe(Schema.brand('OwnerId'));

export type OwnerId = typeof OwnerId.Type;
