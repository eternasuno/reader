import { Result, Schema } from 'effect';

const collapsedFoldersKey = 'reader.collapsedFolders';

const collapsedFoldersSchema = Schema.fromJsonString(
  Schema.Array(Schema.String)
);

const decode = (text: string | null): ReadonlySet<string> => {
  if (text === null) {
    return new Set();
  }

  const result = Schema.decodeResult(collapsedFoldersSchema)(text);

  return new Set(Result.getOrElse(result, () => []));
};

export const readCollapsedFolders = (
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage
): ReadonlySet<string> => decode(storage.getItem(collapsedFoldersKey));

export const writeCollapsedFolders = (
  ids: ReadonlySet<string>,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage
): void => {
  storage.setItem(
    collapsedFoldersKey,
    Schema.encodeSync(collapsedFoldersSchema)([...ids])
  );
};
