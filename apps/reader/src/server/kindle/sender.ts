import type { OwnerId, SendToKindleError } from '@reader/business';
import { Context, Data, type Effect } from 'effect';

/**
 * One send of this owner already runs, so the request starts nothing
 * (KD-SEND-7). The server raises it, the business layer does not: it is the
 * single flight the sender keeps.
 */
export class KindleSendInProgress extends Data.TaggedError(
  'KindleSendInProgress'
)<Record<never, never>> {}

/** What one send answers and fails with (KD-SEND-8). */
export type KindleSend = (
  owner: OwnerId
) => Effect.Effect<
  { readonly count: number },
  SendToKindleError | KindleSendInProgress
>;

/**
 * Sends one owner's unread articles to their Kindle (kindle.md KD-SEND). One
 * send runs per owner at a time: a send-now request while that owner's send
 * runs fails with `KindleSendInProgress`, a scheduled one is skipped.
 */
export class KindleSender extends Context.Service<
  KindleSender,
  { readonly send: KindleSend }
>()('KindleSender') {}
