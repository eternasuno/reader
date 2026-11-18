import { Effect, Schema } from 'effect';

/**
 * Which fetcher is chosen: `jina` by default (SET-GET-1). The provider is
 * `browser` only if an endpoint is stored; the operations hold that invariant,
 * not this value (SET-FETCH-4).
 */
export const FetcherProvider = Schema.Literals(['jina', 'browser']).pipe(
  Schema.withDecodingDefaultType(Effect.succeed('jina' as const))
);

export type FetcherProvider = typeof FetcherProvider.Type;

/** Trimmed, non-empty and redacted (SET-VAL-2, SET-VAL-4). */
export const JinaKey = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('JinaKey'),
  Schema.RedactedFromValue
);

export type JinaKey = typeof JinaKey.Type;

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** A browser service speaks http, https, ws or wss; nothing else (SET-VAL-3). */
const isSupportedProtocol = Schema.makeFilter((url: URL) =>
  SUPPORTED_PROTOCOLS.has(url.protocol)
);

/**
 * The address of the browser service: surrounding whitespace is trimmed, the
 * protocol is http, https, ws or wss, and the value is the URL's standard
 * serialization, so `ws://127.0.0.1:9222` is stored as `ws://127.0.0.1:9222/`
 * (CM-URL-6, SET-VAL-3). Redacted: it never reaches a response, an error or a
 * log (SET-VAL-4).
 */
export const BrowserEndpoint = Schema.Trim.pipe(
  Schema.decodeTo(Schema.URLFromString),
  Schema.check(isSupportedProtocol),
  Schema.brand('BrowserEndpoint'),
  Schema.RedactedFromValue
);

export type BrowserEndpoint = typeof BrowserEndpoint.Type;
