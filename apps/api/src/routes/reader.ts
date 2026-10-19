import { ReaderApi } from '@reader/api';
import {
  credentialStatus,
  readArticle,
  removeReaderKey,
  saveReaderKey,
} from '@reader/business';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Session } from '../middleware/session';

export const readerHandlers = HttpApiBuilder.group(
  ReaderApi,
  'reader',
  (group) =>
    group
      .handle('settings', () =>
        Effect.flatMap(Session, (user) => credentialStatus(user.id))
      )
      .handle('setKey', ({ payload }) =>
        Effect.flatMap(Session, (user) => saveReaderKey(user.id, payload.key))
      )
      .handle('deleteKey', () =>
        Effect.flatMap(Session, (user) => removeReaderKey(user.id))
      )
      .handle('content', ({ query }) =>
        Effect.flatMap(Session, (user) =>
          readArticle(user.id, query.kind, query.key, false, false)
        )
      )
      .handle('extract', ({ payload }) =>
        Effect.flatMap(Session, (user) =>
          readArticle(user.id, payload.kind, payload.key, payload.refresh, true)
        )
      )
);
