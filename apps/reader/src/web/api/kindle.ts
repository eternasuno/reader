import { KindleApi } from '../../contract';
import { requestJson } from './client';

/**
 * Send to Kindle (kindle.md): one send of every unread article, answering how
 * many articles the book held (KD-SEND-8).
 */

const { endpoints } = KindleApi;

/** Sends every unread article now and answers how many went (KD-SEND). */
export const sendToKindle = () =>
  requestJson(endpoints.sendToKindle, (client) =>
    client.kindle.sendToKindle({})
  );
