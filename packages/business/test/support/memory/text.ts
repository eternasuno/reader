const codePoints = (text: string): ReadonlyArray<number> =>
  Array.from(text, (character) => character.codePointAt(0) ?? 0);

/**
 * Code point order, which is UTF-8 byte order, so the doubles order texts the
 * way SQLite's `BINARY` does (FD-LIST-3, FD-FOLDER-8): not `localeCompare`, and
 * not UTF-16 code unit order, which differs for astral characters.
 */
export const compareText = (left: string, right: string): number => {
  const leftPoints = codePoints(left);
  const rightPoints = codePoints(right);
  const shared = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < shared; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return leftPoints.length - rightPoints.length;
};

/** Ids are lower-case UUIDv7 strings, so string order is byte order (CM-ID-1). */
export const byIdDescending = (
  left: { readonly id: string },
  right: { readonly id: string }
): number => compareText(right.id, left.id);
