import { Effect, Schema } from 'effect';
import { OptionFromOptionalNonEmpty } from '../common/option-from-optional-non-empty';

export const FetcherProvider = Schema.Literals(['jina', 'browser']).pipe(
  Schema.withDecodingDefaultType(Effect.succeed('jina' as const))
);

export type FetcherProvider = typeof FetcherProvider.Type;

export const JinaKey = Schema.Trim.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2048),
    Schema.isPattern(/^[^\r\n]*$/)
  ),
  Schema.brand('JinaKey'),
  Schema.RedactedFromValue
);

export type JinaKey = typeof JinaKey.Type;

const supportedProtocols = new Set(['http:', 'https:', 'ws:', 'wss:']);

export const BrowserEndpoint = Schema.URLFromString.pipe(
  Schema.check(
    Schema.makeFilter((url: URL) => supportedProtocols.has(url.protocol))
  ),
  Schema.brand('BrowserEndpoint'),
  Schema.RedactedFromValue
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
