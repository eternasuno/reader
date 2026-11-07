import {
  BrowserEndpoint,
  FetcherProvider,
  JinaKeyUpdate,
  Retention,
  SettingsRepository,
  updateSettings,
} from '@reader/business';
import { Effect, Option, Schema } from 'effect';
import { type HandlerRequest, withSession } from './library-contract';
import {
  invalidEndpoint,
  invalidKey,
  invalidProvider,
  invalidRetention,
} from './library-errors';
import {
  extractionSettingsFailure,
  retentionFailure,
  settingsReadFailure,
  settingsRepositoryFailure,
} from './library-failures';

const decodeInput = <A, E, R, E2>(
  decode: Effect.Effect<A, E, R>,
  onInvalid: () => Effect.Effect<never, E2>
) =>
  Effect.matchEffect(decode, {
    onFailure: onInvalid,
    onSuccess: Effect.succeed,
  });

const settings = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SettingsRepository;
      const value = yield* repository.get(owner);

      return {
        retention: value.feed.retention,
        provider: value.fetcher.provider,
        jinaConfigured: Option.isSome(value.fetcher.jina.key),
        browserEndpoint: Option.map(
          value.fetcher.browser.endpoint,
          (url) => url.href
        ),
      };
    })
  ).pipe(Effect.catchTags(settingsReadFailure));

const setRetention = ({ payload }: HandlerRequest<'setRetention'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const retention = yield* decodeInput(
        Schema.decodeEffect(Retention)(payload.retention),
        invalidRetention
      );

      const repository = yield* SettingsRepository;
      yield* repository.update(owner, { feed: { retention } });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(retentionFailure));

const jinaPatch = (payload: HandlerRequest<'setExtraction'>['payload']) =>
  Effect.gen(function* () {
    const key = yield* decodeInput(
      Schema.decodeEffect(JinaKeyUpdate)(
        Option.getOrUndefined(payload.jinaKey)
      ),
      invalidKey
    );

    return key === undefined ? {} : { jina: { key: Option.some(key) } };
  });

const browserPatch = (payload: HandlerRequest<'setExtraction'>['payload']) =>
  Option.match(payload.browserEndpoint, {
    onNone: () => Effect.succeed({}),
    onSome: (value) =>
      decodeInput(
        Schema.decodeEffect(BrowserEndpoint)(value),
        invalidEndpoint
      ).pipe(
        Effect.map((endpoint) => ({
          browser: { endpoint: Option.some(endpoint) },
        }))
      ),
  });

const extractionFetcher = (
  payload: HandlerRequest<'setExtraction'>['payload']
) =>
  Effect.gen(function* () {
    const provider = yield* decodeInput(
      Schema.decodeUnknownEffect(FetcherProvider)(payload.provider),
      invalidProvider
    );
    const jina = yield* jinaPatch(payload);
    const browser = yield* browserPatch(payload);

    return { provider, ...jina, ...browser };
  });

const setExtraction = ({ payload }: HandlerRequest<'setExtraction'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const fetcher = yield* extractionFetcher(payload);

      yield* updateSettings(owner, { fetcher });

      return { ok: true as const };
    })
  ).pipe(
    Effect.catchTags({
      ...extractionSettingsFailure,
      BrowserEndpointRequired: invalidEndpoint,
    })
  );

const deleteKey = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SettingsRepository;
      yield* repository.update(owner, {
        fetcher: { jina: { key: Option.none() } },
      });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(settingsRepositoryFailure));

const deleteBrowser = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SettingsRepository;
      yield* repository.update(owner, {
        fetcher: {
          provider: 'jina',
          browser: { endpoint: Option.none() },
        },
      });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(settingsRepositoryFailure));

export const settingsHandlers = {
  settings,
  setRetention,
  setExtraction,
  deleteKey,
  deleteBrowser,
};
