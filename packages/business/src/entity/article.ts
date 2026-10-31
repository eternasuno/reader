import { Schema } from 'effect';

export const ReaderProvider = Schema.Literals(['jina', 'browser']);

export type ReaderProvider = typeof ReaderProvider.Type;
