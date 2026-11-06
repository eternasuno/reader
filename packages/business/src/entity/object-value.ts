import { Function as Fn, Option, Schema, SchemaTransformation } from 'effect';

export const OwnerId = Schema.String.pipe(Schema.brand('OwnerId'));

export type OwnerId = typeof OwnerId.Type;

export const FeedId = Schema.String.pipe(Schema.brand('FeedId'));

export type FeedId = typeof FeedId.Type;

const NonBlankText = Schema.optional(Schema.Trim).pipe(
  Schema.decode(
    SchemaTransformation.transformOptional({
      decode: Option.filter((text) => text !== ''),
      encode: (value) => value,
    })
  )
);

export const OptionFromOptionalNonEmpty = Fn.flow(
  Schema.OptionFromOptional,
  (to) => NonBlankText.pipe(Schema.decodeTo(to))
);

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
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(name.toLowerCase())) {
      url.searchParams.delete(name);
    }
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
