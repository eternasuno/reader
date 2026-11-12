import type { LibraryApi } from '@reader/api';
import {
  OwnerId,
  type Setting,
  SettingRepository,
  type WebpageFetcher,
} from '@reader/business';
import {
  BrowserWebpageFetcherLive,
  JinaWebpageFetcherLive,
} from '@reader/webpage';
import { Effect, type Layer, Option, Redacted } from 'effect';
import type { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Session } from '../middleware/session';

type Groups =
  typeof LibraryApi extends HttpApi.HttpApi<string, infer G> ? G : never;

type Group = HttpApiGroup.WithIdentifier<Groups, 'library'>;

type LibraryEndpoints = Group['endpoints'];

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

const webpageFetcherLayerFor = (
  setting: Setting
): Layer.Layer<WebpageFetcher> => {
  const endpoint = setting.fetcher.browser.endpoint;

  return setting.fetcher.provider === 'browser' && Option.isSome(endpoint)
    ? BrowserWebpageFetcherLive(Redacted.value(endpoint.value).href)
    : JinaWebpageFetcherLive(Option.getOrUndefined(setting.fetcher.jina.key));
};

export const fetcherFor = (owner: OwnerId) =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const setting = yield* settings.get(owner);

    return webpageFetcherLayerFor(setting);
  });
