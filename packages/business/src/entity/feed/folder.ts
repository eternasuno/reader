import { Schema } from 'effect';
import { Model } from 'effect/schema';
import { OwnerId } from '../common/owner-id';

export const FolderId = Schema.String.pipe(
  Schema.check(Schema.isUUID(7), Schema.isLowercased()),
  Schema.brand('FolderId')
);

export type FolderId = typeof FolderId.Type;

export const FolderName = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('FolderName')
);

export type FolderName = typeof FolderName.Type;

export const Folder = Schema.Struct({
  id: Model.UuidV7WithGenerate(FolderId),
  ownerId: OwnerId,
  name: FolderName,
});

export type Folder = typeof Folder.Type;
