export type PageInput<Cursor> = {
  readonly unreadOnly: boolean;
  readonly limit: number;
  readonly cursor?: Cursor;
};

export type PageQuery<Cursor> = {
  readonly unreadOnly: boolean;
  readonly limit: number;
  readonly after?: Cursor;
};

export type Page<Row, Cursor> = {
  readonly items: ReadonlyArray<Row>;
  readonly cursor: Cursor | null;
};

export const pageQuery = <Cursor>(
  input: PageInput<Cursor>
): PageQuery<Cursor> => ({
  unreadOnly: input.unreadOnly,
  limit: input.limit + 1,
  ...(input.cursor === undefined ? {} : { after: input.cursor }),
});

export const pageOf = <Cursor, Row extends { readonly id: Cursor }>(
  rows: ReadonlyArray<Row>,
  limit: number
): Page<Row, Cursor> => {
  const items = rows.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    cursor: rows.length > limit && last !== undefined ? last.id : null,
  };
};
