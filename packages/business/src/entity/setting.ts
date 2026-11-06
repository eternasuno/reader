import { Option, Schema, SchemaGetter } from 'effect';
import { OwnerId } from './object-value';

const retentionRange = Schema.Int.check(
  Schema.isBetween({ minimum: 30, maximum: 300 })
);

export const Retention = retentionRange.pipe(Schema.brand('Retention'));

export type Retention = typeof Retention.Type;

export const DEFAULT_RETENTION = Retention.make(100);

export const ReaderProvider = Schema.Literals(['jina', 'browser']);

export type ReaderProvider = typeof ReaderProvider.Type;

export const JinaKeyInput = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(2048), Schema.isPattern(/^[^\r\n]*$/)),
  Schema.decodeTo(Schema.Trim),
  Schema.check(Schema.isMinLength(1)),
  Schema.decodeTo(Schema.RedactedFromValue(Schema.String))
);

const browserEndpointSyntax = Schema.makeFilter(
  (value: string) =>
    value === '' || (!value.includes('#') && URL.canParse(value))
);

const browserEndpointTarget = Schema.makeFilter((value: string) => {
  if (value === '') {
    return true;
  }

  const url = new URL(value);

  return (
    ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
    url.username === '' &&
    url.password === ''
  );
});

export const BrowserEndpointInput = Schema.Trim.pipe(
  Schema.check(Schema.isMaxLength(2048), browserEndpointSyntax),
  Schema.check(browserEndpointTarget)
);

export const BrowserEndpoint = BrowserEndpointInput.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('BrowserEndpoint')
);

export type BrowserEndpoint = typeof BrowserEndpoint.Type;

export const BrowserEndpointUpdate = BrowserEndpointInput.pipe(
  Schema.decodeTo(
    Schema.Option(Schema.String.pipe(Schema.brand('BrowserEndpoint'))),
    {
      decode: SchemaGetter.transform((value) =>
        value === '' ? Option.none() : Option.some(value)
      ),
      encode: SchemaGetter.transform((value) =>
        Option.getOrElse(value, () => '')
      ),
    }
  )
);

export const RequiredBrowserEndpointUpdate = BrowserEndpointUpdate.pipe(
  Schema.check(Schema.makeFilter(Option.isSome))
);

export const JinaKeyUpdate = Schema.UndefinedOr(JinaKeyInput);

export const browserEndpointUpdate = (provider: ReaderProvider) =>
  provider === 'browser'
    ? RequiredBrowserEndpointUpdate
    : Schema.UndefinedOr(BrowserEndpointUpdate);

export const Setting = Schema.Struct({
  ownerId: OwnerId,
  retention: Retention,
  provider: ReaderProvider,
  jinaKey: Schema.OptionFromOptional(Schema.Redacted(Schema.String)),
  browserEndpoint: Schema.OptionFromOptional(BrowserEndpoint),
});

export type Setting = typeof Setting.Type;
