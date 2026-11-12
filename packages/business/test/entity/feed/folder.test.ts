import { describe, expect, it } from '@effect/vitest';
import { Result, Schema } from 'effect';
import { Folder, FolderId, FolderName } from '../../../src/entity/feed/folder';
import { alice, makeFolder } from '../../support';

describe('FolderName', () => {
  it('FD-FOLDER-2 trims the name', () => {
    const decode = Schema.decodeUnknownResult(FolderName);

    expect(Result.getOrThrow(decode('  Tech  '))).toBe('Tech');
  });

  it('FD-FOLDER-2 rejects an empty and a blank name', () => {
    const decode = Schema.decodeUnknownResult(FolderName);

    expect(Result.isFailure(decode(''))).toBe(true);
    expect(Result.isFailure(decode('   '))).toBe(true);
  });

  it('FD-FOLDER-2 keeps the case', () => {
    const decode = Schema.decodeUnknownResult(FolderName);

    expect(Result.getOrThrow(decode('Tech'))).toBe('Tech');
    expect(Result.getOrThrow(decode('tech'))).toBe('tech');
  });
});

describe('Folder', () => {
  it('FD-FOLDER-1 makes a lower-case version-7 id', () => {
    const folder = Folder.make({
      ownerId: alice,
      name: FolderName.make('Tech'),
    });

    expect(Schema.is(FolderId)(folder.id)).toBe(true);
    expect(folder.id).toBe(folder.id.toLowerCase());
  });

  it('keeps the owner and the name', () => {
    const folder = makeFolder({ name: FolderName.make('Tech') });

    expect(folder.ownerId).toBe(alice);
    expect(folder.name).toBe('Tech');
  });

  it('round trips the stored row', () => {
    const folder = makeFolder();
    const encoded = Schema.encodeSync(Folder)(folder);
    const decoded = Schema.decodeSync(Folder)(encoded);

    expect(decoded).toStrictEqual(folder);
  });
});
