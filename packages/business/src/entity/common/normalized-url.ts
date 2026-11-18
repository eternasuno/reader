import { Schema, SchemaTransformation } from 'effect';

/**
 * Query parameter names that never select content and are removed
 * (CM-URL-2). Every name starting with `utm_` is removed too. Generic names
 * such as `ref`, `source`, `from` and `si` are kept, because sites also use
 * them to select content.
 */
const TRACKING_PARAM_NAMES = new Set([
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  '_ga',
  '_gl',
]);

/** Names are matched case-insensitively (CM-URL-2). */
const isTrackingParam = (name: string): boolean => {
  const lowerCaseName = name.toLowerCase();

  return (
    lowerCaseName.startsWith('utm_') || TRACKING_PARAM_NAMES.has(lowerCaseName)
  );
};

const decodeLenient = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parameterName = (component: string): string => {
  const separatorIndex = component.indexOf('=');
  const rawName =
    separatorIndex === -1 ? component : component.slice(0, separatorIndex);

  return decodeLenient(rawName);
};

/**
 * Drops only the tracking components and keeps every other query component
 * byte for byte (CM-URL-2, CM-URL-6), instead of reserializing through
 * `URLSearchParams`.
 */
const withoutTrackingParams = (search: string): string =>
  search
    .slice(1)
    .split('&')
    .filter((component) => !isTrackingParam(parameterName(component)))
    .join('&');

/**
 * Tracking parameters are removed (CM-URL-2) and the fragment is always
 * removed, whatever it contains (CM-URL-3). Credentials are kept as given
 * (CM-URL-4) and nothing else is normalized (CM-URL-6).
 */
const normalizeUrl = (url: URL): URL => {
  const normalized = new URL(url);

  if (normalized.search !== '') {
    normalized.search = withoutTrackingParams(normalized.search);
  }
  normalized.hash = '';

  return normalized;
};

/** Only `http:` and `https:` are accepted (CM-URL-1). */
const isHttpUrl = Schema.makeFilter(
  (url: URL) => url.protocol === 'http:' || url.protocol === 'https:'
);

/**
 * A URL as it is stored and used as a unique key (CM-ID-6): normalized at the
 * boundary, then used through its `href` and never normalized again
 * (CM-URL-5).
 */
export const NormalizedUrl = Schema.URLFromString.pipe(
  Schema.check(isHttpUrl),
  Schema.decodeTo(
    Schema.URL,
    SchemaTransformation.transform({
      decode: normalizeUrl,
      encode: (url) => url,
    })
  ),
  Schema.brand('NormalizedUrl')
);

export type NormalizedUrl = typeof NormalizedUrl.Type;
