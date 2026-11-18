import { describe, expect, it } from '@effect/vitest';
import { Result, Schema } from 'effect';
import { OwnerId } from '../../../src/entity/common/owner-id';
import {
  Folder,
  FolderId,
  FolderName,
} from '../../../src/entity/folder/folder';

const alice = OwnerId.make('alice');

const decodeName = Schema.decodeUnknownResult(FolderName);

describe('FolderName', () => {
  it('FD-FOLDER-2 trims the name', () => {
    expect(Result.getOrThrow(decodeName('  Tech  '))).toBe('Tech');
    expect(Result.getOrThrow(decodeName('\nTech\t'))).toBe('Tech');
  });

  it('FD-FOLDER-2 rejects an empty and a blank name', () => {
    expect(Result.isFailure(decodeName(''))).toBe(true);
    expect(Result.isFailure(decodeName('   '))).toBe(true);
  });

  it('FD-FOLDER-2 compares names case-sensitively, so Tech and tech are two names', () => {
    expect(Result.getOrThrow(decodeName('Tech'))).toBe('Tech');
    expect(Result.getOrThrow(decodeName('tech'))).toBe('tech');
    expect(Result.getOrThrow(decodeName('Tech'))).not.toBe(
      Result.getOrThrow(decodeName('tech'))
    );
  });
});

describe('Folder', () => {
  it('FD-FOLDER-1 makes a lower-case version-7 id when the folder is created', () => {
    const folder = Folder.make({
      ownerId: alice,
      name: FolderName.make('Tech'),
    });

    expect(Schema.is(FolderId)(folder.id)).toBe(true);
    expect(folder.id).toBe(folder.id.toLowerCase());
  });

  it('FD-FOLDER-1 keeps the owner and the stored name', () => {
    const folder = Folder.make({
      ownerId: alice,
      name: FolderName.make('Tech'),
    });
    const decoded = Schema.decodeSync(Folder)(
      Schema.encodeUnknownSync(Folder)(folder)
    );

    expect(folder.ownerId).toBe(alice);
    expect(folder.name).toBe('Tech');
    expect(decoded).toStrictEqual(folder);
  });
});
