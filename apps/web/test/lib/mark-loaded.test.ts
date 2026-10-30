import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  chunkKeys,
  MARK_LOADED_CHUNK_SIZE,
  markLoadedKeys,
  partialMarkLoadedError,
} from '../../src/lib/mark-loaded';

const keys = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `key-${index}`);

describe('mark-loaded chunking', () => {
  it('keeps requests at the backend key limit', () => {
    const chunks = chunkKeys(keys(5001));

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(MARK_LOADED_CHUNK_SIZE);
    expect(chunks[1]).toEqual(['key-5000']);
  });

  it('skips requests for empty snapshots', () => {
    expect(chunkKeys([])).toEqual([]);
  });
});

describe('mark-loaded failures', () => {
  it('fails when no chunk persists', async () => {
    const exit = await Effect.runPromiseExit(
      markLoadedKeys(keys(2), () => Effect.fail('unavailable'))
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('surfaces the failure while retaining only keys from successful chunks', async () => {
    const sent: (readonly string[])[] = [];
    const result = await Effect.runPromise(
      markLoadedKeys(keys(5001), (chunk) => {
        sent.push(chunk);

        return chunk.includes('key-5000')
          ? Effect.fail('chunk failed')
          : Effect.succeed({ ok: true });
      })
    );

    expect(sent).toHaveLength(2);
    expect(result.keys).toHaveLength(MARK_LOADED_CHUNK_SIZE);
    expect(result.keys).not.toContain('key-5000');
    expect(result.failed).toBe(true);
    expect(result.error).toBe(partialMarkLoadedError(5000, 1));
  });
});

describe('mark-loaded success', () => {
  it('reports clean success without a partial error', async () => {
    const result = await Effect.runPromise(
      markLoadedKeys(keys(2), () => Effect.succeed({ ok: true }))
    );

    expect(result).toEqual({ keys: keys(2), failed: false, error: '' });
  });

  it('reports clean success for empty snapshots', async () => {
    const result = await Effect.runPromise(
      markLoadedKeys([], () => Effect.fail('should not send'))
    );

    expect(result).toEqual({ keys: [], failed: false, error: '' });
  });
});
