import { Schema } from 'effect';
import { Model } from 'effect/schema';
import { OwnerId } from '../common/owner-id';

/**
 * A folder of one owner (CM-ID, FD-FOLDER-1). Folders are unique per owner and
 * name, compared case-sensitively (CM-ID-6, FD-FOLDER-2).
 */
export const FolderId = Schema.String.pipe(
  Schema.check(Schema.isUUID(7), Schema.isLowercased()),
  Schema.brand('FolderId')
);

export type FolderId = typeof FolderId.Type;

/**
 * Trimmed, and not empty after trimming: a blank name fails decoding
 * (FD-FOLDER-2).
 */
export const FolderName = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('FolderName')
);

export type FolderName = typeof FolderName.Type;

export const Folder = Schema.Struct({
  /** Made when the folder is created (CM-ID-3). */
  id: Model.UuidV7WithGenerate(FolderId),
  ownerId: OwnerId,
  /** Unique per owner, compared exactly as stored (CM-ID-6, FD-FOLDER-2). */
  name: FolderName,
});

export type Folder = typeof Folder.Type;
