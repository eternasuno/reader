import {
  BrowserEndpoint,
  FolderName,
  JinaKey,
  NormalizedUrl,
  Retention,
} from '@reader/business';
import { Effect, Schema } from 'effect';

const invalid = <Tag extends string>(tag: Tag) => ({ _tag: tag }) as const;

export const decodePageUrl = (
  text: string
): Effect.Effect<NormalizedUrl, { readonly _tag: 'InvalidPageUrl' }> =>
  Schema.decodeEffect(NormalizedUrl)(text).pipe(
    Effect.mapError(() => invalid('InvalidPageUrl'))
  );

export const decodeFeedUrl = (
  text: string
): Effect.Effect<NormalizedUrl, { readonly _tag: 'FeedUrlInvalid' }> =>
  Schema.decodeEffect(NormalizedUrl)(text).pipe(
    Effect.mapError(() => invalid('FeedUrlInvalid'))
  );

export const decodeRetention = (
  value: number
): Effect.Effect<Retention, { readonly _tag: 'InvalidRetention' }> =>
  Schema.decodeEffect(Retention)(value).pipe(
    Effect.mapError(() => invalid('InvalidRetention'))
  );

export const decodeFolderName = (
  text: string
): Effect.Effect<FolderName, { readonly _tag: 'InvalidFolderName' }> =>
  Schema.decodeEffect(FolderName)(text).pipe(
    Effect.mapError(() => invalid('InvalidFolderName'))
  );

const givenText = (text: string | undefined) => {
  const trimmed = text?.trim() ?? '';

  return trimmed === '' ? undefined : text;
};

export const decodeJinaKey = (
  text: string | undefined
): Effect.Effect<JinaKey | undefined, { readonly _tag: 'InvalidKey' }> => {
  const given = givenText(text);

  return given === undefined
    ? Effect.undefined
    : Schema.decodeEffect(JinaKey)(given).pipe(
        Effect.mapError(() => invalid('InvalidKey'))
      );
};

export const decodeBrowserEndpoint = (
  text: string | undefined
): Effect.Effect<
  BrowserEndpoint | undefined,
  { readonly _tag: 'InvalidEndpoint' }
> => {
  const given = givenText(text);

  return given === undefined
    ? Effect.undefined
    : Schema.decodeEffect(BrowserEndpoint)(given).pipe(
        Effect.mapError(() => invalid('InvalidEndpoint'))
      );
};
