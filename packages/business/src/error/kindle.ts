import { Data } from 'effect';

/** No Kindle delivery is saved, so there is nowhere to send (KD-SEND-1). */
export class KindleNotConfigured extends Data.TaggedError(
  'KindleNotConfigured'
)<Record<never, never>> {}

/** The EPUB could not be built (KD-SEND-5); the message is safe to log. */
export class EpubBuilderError extends Data.TaggedError('EpubBuilderError')<{
  readonly message: string;
}> {}

/**
 * The SMTP server refused or could not be reached (KD-SEND-6). The message is
 * safe to log: it never carries the password (SET-VAL-4).
 */
export class MailSenderError extends Data.TaggedError('MailSenderError')<{
  readonly message: string;
}> {}
