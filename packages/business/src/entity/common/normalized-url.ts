import { Schema, SchemaTransformation } from 'effect';

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

const isTrackingParam = (name: string): boolean => {
  const lowerCaseName = name.toLowerCase();

  return (
    lowerCaseName.startsWith('utm_') || TRACKING_PARAM_NAMES.has(lowerCaseName)
  );
};

const removeTrackingParams = (url: URL): void => {
  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) {
      url.searchParams.delete(name);
    }
  }
};

const normalizeUrl = (url: URL): URL => {
  const normalized = new URL(url);
  removeTrackingParams(normalized);
  normalized.hash = '';

  return normalized;
};

const isHttpUrl = Schema.makeFilter(
  (url: URL) => url.protocol === 'http:' || url.protocol === 'https:'
);

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
