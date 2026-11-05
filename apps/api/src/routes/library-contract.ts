import type { LibraryApi } from '@reader/api';
import { OwnerId } from '@reader/business';
import { Effect, Option } from 'effect';
import type { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session } from '../middleware/session';

type Groups =
  typeof LibraryApi extends HttpApi.HttpApi<string, infer G> ? G : never;

type Group = HttpApiGroup.WithIdentifier<Groups, 'library'>;

export type LibraryEndpoints = Group['endpoints'];

export type HandlerRequest<Identifier extends keyof LibraryEndpoints> =
  Parameters<
    HttpApiEndpoint.Handler<LibraryEndpoints[Identifier], never, never>
  >[0];

export const withSession = <A, E, R>(
  use: (owner: OwnerId) => Effect.Effect<A, E, R>
) => Effect.flatMap(Session, (user) => use(OwnerId.make(user.id)));

export const optionToNull = <A>(value: Option.Option<A>): A | null =>
  Option.match(value, {
    onNone: () => null,
    onSome: (item) => item,
  });
