import { Data, Effect, Option, Redacted } from 'effect';
import type { OwnerId } from '../entity/object-value';
import type { ReaderProvider } from '../entity/setting';
import { SettingsRepository } from '../port/settings-repository';

export class SettingsReadError extends Data.TaggedError('SettingsReadError')<{
  readonly message: string;
}> {}

export class SettingsSaveError extends Data.TaggedError('SettingsSaveError')<{
  readonly message: string;
}> {}

export class InvalidRetention extends Data.TaggedError('InvalidRetention')<{
  readonly message: string;
}> {}

export class InvalidKey extends Data.TaggedError('InvalidKey')<{
  readonly message: string;
}> {}

export class InvalidEndpoint extends Data.TaggedError('InvalidEndpoint')<{
  readonly message: string;
}> {}

export class InvalidProvider extends Data.TaggedError('InvalidProvider')<{
  readonly message: string;
}> {}

export type ExtractionUpdate = {
  readonly provider: string;
  readonly jinaKey?: string;
  readonly browserEndpoint?: string;
};

const MIN_RETENTION = 30;

const MAX_RETENTION = 300;

const MAX_SETTING_LENGTH = 2048;

const BROWSER_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

const isValidRetention = (value: number) =>
  Number.isInteger(value) && value >= MIN_RETENTION && value <= MAX_RETENTION;

const parseProvider = (value: string): ReaderProvider | undefined =>
  value === 'jina' || value === 'browser' ? value : undefined;

const isValidKey = (value: string) =>
  value.trim().length > 0 &&
  value.length <= MAX_SETTING_LENGTH &&
  !/[\r\n]/.test(value);

const isValidBrowserEndpoint = (value: string) => {
  if (value.length > MAX_SETTING_LENGTH || value.includes('#')) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      BROWSER_PROTOCOLS.has(url.protocol) &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
};

export const getSettings = Effect.fn('settings.get')(function* (
  owner: OwnerId
) {
  const settingsRepository = yield* SettingsRepository;
  const value = yield* settingsRepository
    .get(owner)
    .pipe(
      Effect.mapError(
        () => new SettingsReadError({ message: 'Failed to read settings' })
      )
    );

  return {
    retention: value.retention,
    provider: value.provider,
    jinaConfigured: Option.isSome(value.jinaKey),
    browserEndpoint: value.browserEndpoint,
  };
});

export const updateRetention = Effect.fn('settings.updateRetention')(function* (
  owner: OwnerId,
  value: number
) {
  if (!isValidRetention(value)) {
    return yield* new InvalidRetention({
      message: 'Retention must be an integer between 30 and 300',
    });
  }

  const settingsRepository = yield* SettingsRepository;
  yield* settingsRepository
    .update(owner, { retention: value })
    .pipe(
      Effect.mapError(
        () => new SettingsSaveError({ message: 'Failed to save settings' })
      )
    );

  return { ok: true };
});

const extractionPatch = (
  input: ExtractionUpdate,
  provider: ReaderProvider,
  endpoint: string | undefined
) => ({
  provider,
  ...(input.jinaKey === undefined
    ? {}
    : { jinaKey: Option.some(Redacted.make(input.jinaKey.trim())) }),
  ...(endpoint === undefined
    ? {}
    : {
        browserEndpoint:
          endpoint === '' ? Option.none<string>() : Option.some(endpoint),
      }),
});

const parseExtraction = (input: ExtractionUpdate) => {
  const provider = parseProvider(input.provider);
  if (provider === undefined) {
    return {
      ok: false,
      error: new InvalidProvider({
        message: 'Select a valid article extraction method',
      }),
    } as const;
  }

  if (input.jinaKey !== undefined && !isValidKey(input.jinaKey)) {
    return {
      ok: false,
      error: new InvalidKey({ message: 'Enter a valid Jina API key' }),
    } as const;
  }

  const endpoint = input.browserEndpoint?.trim();
  const endpointInvalid =
    endpoint !== undefined &&
    endpoint !== '' &&
    !isValidBrowserEndpoint(endpoint);
  const browserEndpointMissing =
    provider === 'browser' && (endpoint === undefined || endpoint === '');
  if (endpointInvalid || browserEndpointMissing) {
    return {
      ok: false,
      error: new InvalidEndpoint({
        message: 'Enter a valid browser service endpoint',
      }),
    } as const;
  }

  return {
    ok: true,
    settingsPatch: extractionPatch(input, provider, endpoint),
  } as const;
};

export const updateExtraction = Effect.fn('settings.updateExtraction')(
  function* (owner: OwnerId, input: ExtractionUpdate) {
    const parsed = parseExtraction(input);
    if (!parsed.ok) {
      return yield* parsed.error;
    }

    const settingsRepository = yield* SettingsRepository;
    yield* settingsRepository
      .update(owner, parsed.settingsPatch)
      .pipe(
        Effect.mapError(
          () => new SettingsSaveError({ message: 'Failed to save settings' })
        )
      );

    return { ok: true };
  }
);
