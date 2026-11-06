import { Brand, Option, Schema, SchemaTransformation } from 'effect';

export const OwnerId = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand('OwnerId')
);

export type OwnerId = typeof OwnerId.Type;

export const FeedId = Schema.String.pipe(Schema.brand('FeedId'));

export type FeedId = typeof FeedId.Type;

export const OptionalTrimmedString = Schema.OptionFromOptional(
  Schema.Trim
).pipe(
  Schema.decode(
    SchemaTransformation.transform({
      decode: (value) => Option.filter(value, (text) => text !== ''),
      encode: (value) => value,
    })
  ),
  Schema.brand('OptionalTrimmedString')
);

export type OptionalTrimmedString = typeof OptionalTrimmedString.Type;

export const optionalTrimmedString = Brand.nominal<OptionalTrimmedString>();

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'dclid',
  'fbclid',
  'msclkid',
]);

const normalizeUrl = (url: URL): URL => {
  const tracking = new Set(
    [...url.searchParams.keys()].filter((name) =>
      TRACKING_PARAMS.has(name.toLowerCase())
    )
  );
  for (const name of tracking) {
    url.searchParams.delete(name);
  }

  return url;
};

export const NormalizedUrl = Schema.URLFromString.pipe(
  Schema.check(
    Schema.makeFilter(
      (url) => url.protocol === 'http:' || url.protocol === 'https:'
    )
  ),
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
