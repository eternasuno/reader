import { ApiError } from '@reader/api';
import {
  BrowserEndpoint,
  FolderName,
  JinaKey,
  NormalizedUrl,
  Retention,
} from '@reader/business';
import { Effect, Schema } from 'effect';

export const decodePageUrl = (
  text: string
): Effect.Effect<NormalizedUrl, ApiError.InvalidPageUrl> =>
  Schema.decodeEffect(NormalizedUrl)(text).pipe(
    Effect.mapError(() => new ApiError.InvalidPageUrl())
  );

export const decodeFeedUrl = (
  text: string
): Effect.Effect<NormalizedUrl, ApiError.FeedUrlInvalid> =>
  Schema.decodeEffect(NormalizedUrl)(text).pipe(
    Effect.mapError(() => new ApiError.FeedUrlInvalid())
  );

export const decodeRetention = (
  value: number
): Effect.Effect<Retention, ApiError.InvalidRetention> =>
  Schema.decodeEffect(Retention)(value).pipe(
    Effect.mapError(() => new ApiError.InvalidRetention())
  );

export const decodeFolderName = (
  text: string
): Effect.Effect<FolderName, ApiError.InvalidFolderName> =>
  Schema.decodeEffect(FolderName)(text).pipe(
    Effect.mapError(() => new ApiError.InvalidFolderName())
  );

const givenText = (text: string | undefined) => {
  const trimmed = text?.trim() ?? '';

  return trimmed === '' ? undefined : text;
};

export const decodeJinaKey = (
  text: string | undefined
): Effect.Effect<JinaKey | undefined> => {
  const given = givenText(text);

  return given === undefined
    ? Effect.undefined
    : Schema.decodeEffect(JinaKey)(given).pipe(Effect.orDie);
};

export const decodeBrowserEndpoint = (
  text: string | undefined
): Effect.Effect<BrowserEndpoint | undefined, ApiError.InvalidEndpoint> => {
  const given = givenText(text);

  return given === undefined
    ? Effect.undefined
    : Schema.decodeEffect(BrowserEndpoint)(given).pipe(
        Effect.mapError(() => new ApiError.InvalidEndpoint())
      );
};
