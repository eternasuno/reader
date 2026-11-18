import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import {
  EpubBuilderError,
  FeedItemRepositoryError,
  FeedRepositoryError,
  KindleNotConfigured,
  KindleSendInProgress,
  MailSenderError,
  SavedPageRepositoryError,
  SettingRepositoryError,
} from './errors';
import { OriginCheck } from './middleware';

/** Send to Kindle: one send now, answering how many articles went (kindle.md API). */
export const KindleApi = HttpApiGroup.make('kindle').add(
  HttpApiEndpoint.post('sendToKindle', '/kindle/send', {
    success: Schema.Struct({ count: Schema.Int }),
    error: [
      KindleNotConfigured,
      KindleSendInProgress,
      MailSenderError,
      EpubBuilderError,
      SettingRepositoryError,
      FeedRepositoryError,
      FeedItemRepositoryError,
      SavedPageRepositoryError,
    ],
  }).middleware(OriginCheck)
);
