import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { ReaderApi } from '../../contract';
import { KindleSender } from '../kindle/sender';
import { handle } from './errors';

/**
 * Sends every unread article to the Kindle and answers how many went
 * (KD-SEND-8). The request runs the whole send; a send already running for
 * this owner answers `KindleSendInProgress` and starts nothing (KD-SEND-7).
 */
const sendToKindle = HttpApiBuilder.handler(
  ReaderApi,
  'kindle',
  'sendToKindle',
  () =>
    handle((owner) =>
      Effect.flatMap(KindleSender, (sender) => sender.send(owner))
    )
);

export const KindleHandlersLive = HttpApiBuilder.group(
  ReaderApi,
  'kindle',
  (handlers) => handlers.handleAll({ sendToKindle })
);
