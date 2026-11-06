import {
  browserEndpointUpdate,
  getSettings,
  JinaKeyUpdate,
  ReaderProvider,
  Retention,
  type SettingsPatch,
  SettingsRepository,
  updateExtraction,
  updateRetention,
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
    Effect.map(getSettings(owner), (value) => ({
      retention: value.retention,
      provider: value.provider,
      jinaConfigured: Option.isSome(value.jinaKey),
      browserEndpoint: value.browserEndpoint,
    }))
  ).pipe(Effect.catchTags(settingsReadFailure));

const setRetention = ({ payload }: HandlerRequest<'setRetention'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const retention = yield* decodeInput(
        Schema.decodeEffect(Retention)(payload.retention),
        invalidRetention
      );

      yield* updateRetention(owner, retention);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(retentionFailure));

const extractionInput = (payload: HandlerRequest<'setExtraction'>['payload']) =>
  Effect.gen(function* () {
    const provider = yield* decodeInput(
      Schema.decodeUnknownEffect(ReaderProvider)(payload.provider),
      invalidProvider
    );
    const jinaKey = yield* decodeInput(
      Schema.decodeEffect(JinaKeyUpdate)(
        Option.getOrUndefined(payload.jinaKey)
      ),
      invalidKey
    );
    const browserEndpoint = yield* decodeInput(
      Schema.decodeEffect(browserEndpointUpdate(provider))(
        Option.getOrUndefined(payload.browserEndpoint)
      ),
      invalidEndpoint
    );

    return {
      provider,
      ...(jinaKey === undefined ? {} : { jinaKey: Option.some(jinaKey) }),
      ...(browserEndpoint === undefined ? {} : { browserEndpoint }),
    } satisfies SettingsPatch;
  });

const setExtraction = ({ payload }: HandlerRequest<'setExtraction'>) =>
  withSession((owner) =>
    Effect.gen(function* () {
      const input = yield* extractionInput(payload);

      yield* updateExtraction(owner, input);

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(extractionFailure));

const deleteKey = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const extractionSettings = yield* SettingsRepository;
      yield* extractionSettings.update(owner, { jinaKey: Option.none() });

      return { ok: true as const };
    })
  ).pipe(Effect.catchTags(settingsRepositoryFailure));

const deleteBrowser = () =>
  withSession((owner) =>
    Effect.gen(function* () {
      const extractionSettings = yield* SettingsRepository;
      yield* extractionSettings.update(owner, {
        browserEndpoint: Option.none(),
        provider: 'jina',
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
