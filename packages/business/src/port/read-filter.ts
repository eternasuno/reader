import { Schema } from 'effect';

export const ReadFilter = Schema.Literals(['all', 'unread', 'read']);

export type ReadFilter = typeof ReadFilter.Type;
