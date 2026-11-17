import { Function as Fn, Option, Schema, SchemaTransformation } from 'effect';

/**
 * Text that is trimmed, and none when it is absent or blank after trimming
 * (CM-ART-3). Entities keep optional values as `Option`, so their JSON omits
 * an absent field instead of writing `null`.
 */
const NonBlankText = Schema.optional(Schema.Trim).pipe(
  Schema.decode(
    SchemaTransformation.transformOptional({
      decode: Option.filter((text) => text !== ''),
      encode: (value) => value,
    })
  )
);

/**
 * `OptionFromOptionalNonEmpty(ArticleContent)` decodes `undefined` and blank
 * text to none (CM-ART-3) and wraps a value in `Option`.
 */
export const OptionFromOptionalNonEmpty = Fn.flow(
  Schema.OptionFromOptional,
  (to) => Schema.decodeTo(to)(NonBlankText)
);
