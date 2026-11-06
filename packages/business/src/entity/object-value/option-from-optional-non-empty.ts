import { Function as Fn, Option, Schema, SchemaTransformation } from 'effect';

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
