import { Effect, Schema } from 'effect';
import { OptionFromOptionalNonEmpty } from '../object-value/option-from-optional-non-empty';

export const FetcherProvider = Schema.Literals(['jina', 'browser']).pipe(
  Schema.withDecodingDefaultType(Effect.succeed('jina' as const))
);

export type FetcherProvider = typeof FetcherProvider.Type;

export const JinaKey = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.decodeTo(Schema.RedactedFromValue(Schema.String))
);

export type JinaKey = typeof JinaKey.Type;

const browserEndpointProtocol = Schema.makeFilter((url: URL) =>
  ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
);

export const BrowserEndpoint = Schema.URLFromString.pipe(
  Schema.check(browserEndpointProtocol),
  Schema.brand('BrowserEndpoint')
);

export type BrowserEndpoint = typeof BrowserEndpoint.Type;

export const JinaSetting = Schema.Struct({
  key: OptionFromOptionalNonEmpty(JinaKey),
});

export type JinaSetting = typeof JinaSetting.Type;

export const BrowserSetting = Schema.Struct({
  endpoint: OptionFromOptionalNonEmpty(BrowserEndpoint),
});

export type BrowserSetting = typeof BrowserSetting.Type;

export const FetcherSetting = Schema.Struct({
  provider: FetcherProvider,
  jina: JinaSetting,
  browser: BrowserSetting,
});

export type FetcherSetting = typeof FetcherSetting.Type;
