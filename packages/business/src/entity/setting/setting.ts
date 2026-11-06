import { Effect, Option, Schema } from 'effect';
import { OptionFromOptionalNonEmpty } from '../object-value/option-from-optional-non-empty';
import { OwnerId } from '../object-value/owner-id';

export const Retention = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 30, maximum: 300 })),
  Schema.withDecodingDefaultType(Effect.succeed(100)),
  Schema.brand('Retention')
);

export type Retention = typeof Retention.Type;

export const FetcherProvider = Schema.Literals(['jina', 'browser']).pipe(
  Schema.withDecodingDefaultType(Effect.succeed('jina' as const))
);

export type FetcherProvider = typeof FetcherProvider.Type;

const browserEndpointProtocol = Schema.makeFilter((url: URL) =>
  ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
);

export const BrowserEndpoint = Schema.URLFromString.pipe(
  Schema.check(browserEndpointProtocol),
  Schema.brand('BrowserEndpoint')
);

export type BrowserEndpoint = typeof BrowserEndpoint.Type;

export const JinaKey = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.decodeTo(Schema.RedactedFromValue(Schema.String))
);

export type JinaKey = typeof JinaKey.Type;

export const JinaFetcherSetting = Schema.Struct({
  provider: Schema.Literals(['jina']),
  key: OptionFromOptionalNonEmpty(JinaKey),
  endpoint: OptionFromOptionalNonEmpty(BrowserEndpoint),
});

export type JinaFetcherSetting = typeof JinaFetcherSetting.Type;

export const BrowserFetcherSetting = Schema.Struct({
  provider: Schema.Literals(['browser']),
  key: OptionFromOptionalNonEmpty(JinaKey),
  endpoint: BrowserEndpoint,
});

export type BrowserFetcherSetting = typeof BrowserFetcherSetting.Type;

export const FetcherSetting = Schema.Union([
  JinaFetcherSetting,
  BrowserFetcherSetting,
]);

export type FetcherSetting = typeof FetcherSetting.Type;

export const fetcherEndpoint = (
  fetcher: FetcherSetting
): Option.Option<BrowserEndpoint> =>
  fetcher.provider === 'browser'
    ? Option.some(fetcher.endpoint)
    : fetcher.endpoint;

export const Setting = Schema.Struct({
  ownerId: OwnerId,
  retention: Retention,
  fetcher: FetcherSetting,
});

export type Setting = typeof Setting.Type;
