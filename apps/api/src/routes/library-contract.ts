import type { LibraryApi } from '@reader/api';
import {
  OwnerId,
  type Setting,
  SettingRepository,
  type WebpageFetcher,
} from '@reader/business';
import type { BrowserConcurrency } from '@reader/webpage';
import { Effect, type Layer, Option } from 'effect';
import type { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import {
  browserWebpageFetcherLive,
  jinaWebpageFetcherLive,
} from '../adapter/webpage-fetcher';
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

const jinaFetcher = (setting: Setting) =>
  jinaWebpageFetcherLive(Option.getOrUndefined(setting.fetcher.jina.key));

export const webpageFetcherLayerFor = (
  setting: Setting
): Layer.Layer<WebpageFetcher, never, BrowserConcurrency> => {
  const endpoint = setting.fetcher.browser.endpoint;

  return setting.fetcher.provider === 'browser' && Option.isSome(endpoint)
    ? browserWebpageFetcherLive(endpoint.value)
    : jinaFetcher(setting);
};

export const fetcherFor = (owner: OwnerId) =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const setting = yield* settings.get(owner);

    return webpageFetcherLayerFor(setting);
  });
