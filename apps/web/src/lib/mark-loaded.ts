import { Effect } from 'effect';

export const MARK_LOADED_CHUNK_SIZE = 5000;

export type MarkLoadedResult = {
  readonly keys: readonly string[];
  readonly failed: boolean;
  readonly error: string;
};

export const partialMarkLoadedError = (
  completed: number,
  failed: number
): string => `已标记 ${completed} 条，${failed} 条标记失败，请重试`;

export const chunkKeys = (
  keys: readonly string[]
): readonly (readonly string[])[] => {
  const chunks: (readonly string[])[] = [];
  for (let index = 0; index < keys.length; index += MARK_LOADED_CHUNK_SIZE) {
    chunks.push(keys.slice(index, index + MARK_LOADED_CHUNK_SIZE));
  }

  return chunks;
};

type ChunkOutcome<E> =
  | { readonly _tag: 'Success'; readonly keys: readonly string[] }
  | {
      readonly _tag: 'Failure';
      readonly keys: readonly string[];
      readonly error: E;
    };

export const markLoadedKeys = <E>(
  keys: readonly string[],
  send: (keys: readonly string[]) => Effect.Effect<unknown, E>
): Effect.Effect<MarkLoadedResult, E> =>
  Effect.forEach(
    chunkKeys(keys),
    (chunk) =>
      send(chunk).pipe(
        Effect.match({
          onFailure: (error): ChunkOutcome<E> => ({
            _tag: 'Failure',
            keys: chunk,
            error,
          }),
          onSuccess: (): ChunkOutcome<E> => ({ _tag: 'Success', keys: chunk }),
        })
      ),
    { concurrency: 1 }
  ).pipe(
    Effect.flatMap((outcomes) => {
      const succeeded = outcomes.flatMap((outcome) =>
        outcome._tag === 'Success' ? outcome.keys : []
      );
      const failed = outcomes.flatMap((outcome) =>
        outcome._tag === 'Failure' ? outcome.keys : []
      );
      const failure = outcomes.find(
        (outcome): outcome is Extract<ChunkOutcome<E>, { _tag: 'Failure' }> =>
          outcome._tag === 'Failure'
      );
      if (succeeded.length === 0 && failure) return Effect.fail(failure.error);

      return Effect.succeed({
        keys: succeeded,
        failed: failed.length > 0,
        error:
          failed.length === 0
            ? ''
            : partialMarkLoadedError(succeeded.length, failed.length),
      });
    })
  );
