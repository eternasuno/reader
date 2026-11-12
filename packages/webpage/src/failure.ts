import { Data } from 'effect';

export class FetchFailure extends Data.TaggedError('FetchFailure')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
