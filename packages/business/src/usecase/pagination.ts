import { type DateTime, Effect, Option, Stream } from 'effect';
import type { OwnerId } from '../entity/object-value/owner-id';
import type { ReadFilter } from '../port/read-filter';
import {
  encodeListCursor,
  InvalidCursor,
  type ListCursor,
  type ListCursorScope,
} from './list-cursor';

const PAGE_SIZE = 30;

type Boundary<Id extends string> = {
  readonly publishedAt: DateTime.Utc;
  readonly id: Id;
};

type PageQuery<Id extends string> = {
  readonly filter: ReadFilter;
  readonly after?: Boundary<Id>;
  readonly through?: Boundary<Id>;
  readonly limit: number;
};

type Paging<Item extends Boundary<Id>, Id extends string, E, R> = {
  readonly owner: OwnerId;
  readonly scope: ListCursorScope;
  readonly filter: ReadFilter;
  readonly toId: (id: string) => Id;
  readonly fetch: (
    query: PageQuery<Id>
  ) => Effect.Effect<ReadonlyArray<Item>, E, R>;
};

const scopeKey = (scope: ListCursorScope): string =>
  scope.kind === 'saved'
    ? 'saved'
    : `feeds:${Option.getOrElse(scope.feedId, () => '')}`;

const pageQuery = <Id extends string>(
  filter: ReadFilter,
  after: Boundary<Id> | undefined,
  through: Boundary<Id> | undefined
): PageQuery<Id> => ({
  filter,
  limit: PAGE_SIZE + 1,
  ...(after === undefined ? {} : { after }),
  ...(through === undefined ? {} : { through }),
});

const continuationOf = <Id extends string>(
  rows: ReadonlyArray<Boundary<Id>>
): Option.Option<Boundary<Id>> => {
  const last = rows.at(-1);

  return rows.length > PAGE_SIZE && last !== undefined
    ? Option.some({ publishedAt: last.publishedAt, id: last.id })
    : Option.none();
};

const cursorBoundary = <Item extends Boundary<Id>, Id extends string, E, R>(
  { owner, scope, filter, toId }: Paging<Item, Id, E, R>,
  cursor: ListCursor
): Effect.Effect<Boundary<Id>, InvalidCursor> =>
  cursor.owner === owner &&
  cursor.filter === filter &&
  scopeKey(cursor.scope) === scopeKey(scope)
    ? Effect.succeed({
        publishedAt: cursor.after.publishedAt,
        id: toId(cursor.after.id),
      })
    : Effect.fail(new InvalidCursor({ message: 'Invalid pagination cursor' }));

const optionalBoundary = <Item extends Boundary<Id>, Id extends string, E, R>(
  paging: Paging<Item, Id, E, R>,
  cursor: ListCursor | undefined
): Effect.Effect<Boundary<Id> | undefined, InvalidCursor> =>
  cursor === undefined
    ? Effect.succeed(undefined)
    : cursorBoundary(paging, cursor);

const tokenOf = <Item extends Boundary<Id>, Id extends string, E, R>(
  { owner, scope, filter }: Paging<Item, Id, E, R>,
  item: Item
): string =>
  encodeListCursor({
    owner,
    scope,
    filter,
    publishedAt: item.publishedAt,
    id: item.id,
  });

const listPage = <Item extends Boundary<Id>, Id extends string, E, R>(
  paging: Paging<Item, Id, E, R>,
  cursor: ListCursor | undefined,
  through: ListCursor | undefined
) =>
  Effect.gen(function* () {
    const after = yield* optionalBoundary(paging, cursor);
    const boundary = yield* optionalBoundary(paging, through);
    const rows = yield* paging.fetch(pageQuery(paging.filter, after, boundary));
    const items = rows.slice(0, PAGE_SIZE);
    const last = items.at(-1);
    const tail = last === undefined ? null : tokenOf(paging, last);

    return {
      items,
      cursor: rows.length > PAGE_SIZE ? tail : null,
      boundary: tail,
    };
  });

const refreshPages = <Item extends Boundary<Id>, Id extends string, E, R>(
  paging: Paging<Item, Id, E, R>,
  through: ListCursor
) =>
  Effect.gen(function* () {
    const boundary = yield* cursorBoundary(paging, through);

    return yield* Stream.paginate(
      undefined as Boundary<Id> | undefined,
      (after) =>
        Effect.map(
          paging.fetch(pageQuery(paging.filter, after, boundary)),
          (rows) => [rows, continuationOf(rows)] as const
        )
    ).pipe(Stream.runCollect);
  });

export const makePaging = <Item extends Boundary<Id>, Id extends string, E, R>(
  paging: Paging<Item, Id, E, R>
) => ({
  list: (cursor?: ListCursor, through?: ListCursor) =>
    listPage(paging, cursor, through),
  refresh: (through: ListCursor) => refreshPages(paging, through),
});
