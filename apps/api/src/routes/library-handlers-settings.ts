import {
  BrowserEndpoint,
  FetcherProvider,
  type FetcherSetting,
  fetcherEndpoint,
  JinaKeyUpdate,
  Retention,
  type Setting,
  type SettingsPatch,
  SettingsRepository,
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
  extractionFailure,
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
        retention: value.retention,
        provider: value.fetcher.provider,
        jinaConfigured: Option.isSome(value.fetcher.key),
        browserEndpoint: Option.map(
          fetcherEndpoint(value.fetcher),
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
      yield* repository.update(owner, { retention });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(retentionFailure));

const extractionFetcher = (
  current: Setting,
  payload: HandlerRequest<'setExtraction'>['payload']
) =>
  Effect.gen(function* () {
    const provider = yield* decodeInput(
      Schema.decodeUnknownEffect(FetcherProvider)(payload.provider),
      invalidProvider
    );
    const key = yield* decodeInput(
      Schema.decodeEffect(JinaKeyUpdate)(
        Option.getOrUndefined(payload.jinaKey)
      ),
      invalidKey
    );
    const endpoint = yield* Option.match(payload.browserEndpoint, {
      onNone: () => Effect.succeed(fetcherEndpoint(current.fetcher)),
      onSome: (value) =>
        decodeInput(
          Schema.decodeEffect(BrowserEndpoint)(value),
          invalidEndpoint
        ).pipe(Effect.map(Option.some)),
    });

    const fetcherKey =
      key === undefined ? current.fetcher.key : Option.some(key);

    return yield* provider === 'browser'
      ? Option.match(endpoint, {
          onNone: invalidEndpoint,
          onSome: (value) =>
            Effect.succeed<FetcherSetting>({
              provider,
              key: fetcherKey,
              endpoint: value,
            }),
        })
      : Effect.succeed<FetcherSetting>({ provider, key: fetcherKey, endpoint });
  });

const setExtraction = ({ payload }: HandlerRequest<'setExtraction'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SettingsRepository;
      const current = yield* repository.get(owner);
      const fetcher = yield* extractionFetcher(current, payload);

      yield* repository.update(owner, { fetcher } satisfies SettingsPatch);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(extractionFailure));

const deleteKey = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SettingsRepository;
      const current = yield* repository.get(owner);
      yield* repository.update(owner, {
        fetcher: { ...current.fetcher, key: Option.none() },
      });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(settingsRepositoryFailure));

const deleteBrowser = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const repository = yield* SettingsRepository;
      const current = yield* repository.get(owner);
      yield* repository.update(owner, {
        fetcher: {
          provider: 'jina',
          key: current.fetcher.key,
          endpoint: Option.none(),
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
