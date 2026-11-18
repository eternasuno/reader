import {
  type IMailSender,
  MailSender,
  MailSenderError,
  type OutgoingMail,
  type SmtpServer,
} from '@reader/business';
import { Effect, Layer, Option, Redacted } from 'effect';
import type { SendMailOptions } from 'nodemailer';
import nodemailer from 'nodemailer';

/** What nodemailer needs to reach the saved SMTP server (SET-KINDLE-1). */
export type TransportOptions = {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly requireTLS: boolean;
  readonly auth?: { readonly user: string; readonly pass: string };
};

/** The transport one send opens and always closes (KD-SEND-6). */
export type Transport = {
  readonly sendMail: (message: SendMailOptions) => Promise<unknown>;
  readonly close: () => void;
};

/** Creates the transport of one send; tests pass a fake instead. */
export type CreateTransport = (options: TransportOptions) => Transport;

/** The login is sent only when both the user and the password are saved (KD-SEND-4). */
const login = (server: SmtpServer): TransportOptions['auth'] | undefined =>
  Option.isSome(server.user) && Option.isSome(server.password)
    ? { user: server.user.value, pass: Redacted.value(server.password.value) }
    : undefined;

/** `tls` connects over TLS at once; `starttls` upgrades a plain connection (SET-KINDLE-1). */
const transportOptions = (server: SmtpServer): TransportOptions => {
  const auth = login(server);

  return {
    host: server.host,
    port: server.port,
    secure: server.security === 'tls',
    requireTLS: server.security === 'starttls',
    ...(auth === undefined ? {} : { auth }),
  };
};

/** The fields nodemailer adds to an `Error`; everything else stays out of a message. */
type SmtpFailure = {
  readonly code?: unknown;
  readonly responseCode?: unknown;
};

// A rejection carries an Error with the SMTP codes attached.
const failureOf = (error: unknown): SmtpFailure =>
  typeof error === 'object' && error !== null ? (error as SmtpFailure) : {};

/**
 * Names the failure with safe fields only: nodemailer's `code` and
 * `responseCode`. Its own message and response can echo the login, so neither
 * is used (SET-VAL-4).
 */
const failureMessage = (error: unknown): string => {
  const failure = failureOf(error);
  const code = typeof failure.code === 'string' ? failure.code : undefined;
  const responseCode =
    typeof failure.responseCode === 'number' ? failure.responseCode : undefined;
  const details: Array<string> = [];

  if (code !== undefined) details.push(`code ${code}`);
  if (responseCode !== undefined) details.push(`response code ${responseCode}`);

  return details.length === 0
    ? 'SMTP send failed'
    : `SMTP send failed (${details.join(', ')})`;
};

/** One mail from the sender to the Kindle address with the book attached (KD-SEND-4). */
const messageOf = (mail: OutgoingMail): SendMailOptions => ({
  from: mail.from,
  to: mail.to,
  subject: mail.subject,
  text: mail.subject,
  attachments: [
    {
      filename: mail.attachment.filename,
      contentType: mail.attachment.contentType,
      content: Buffer.from(mail.attachment.content),
    },
  ],
});

/**
 * Sends one mail and closes the transport whatever the outcome. Any rejection
 * of `sendMail` is a `MailSenderError` whose message never carries the
 * password (KD-SEND-6, SET-VAL-4).
 */
const deliver = Effect.fnUntraced(function* (
  createTransport: CreateTransport,
  mail: OutgoingMail
) {
  yield* Effect.acquireUseRelease(
    Effect.sync(() => createTransport(transportOptions(mail.server))),
    (transport) =>
      Effect.tryPromise({
        try: () => transport.sendMail(messageOf(mail)),
        catch: (error) =>
          new MailSenderError({ message: failureMessage(error) }),
      }).pipe(Effect.asVoid),
    (transport) => Effect.sync(() => transport.close())
  );
});

/**
 * The `MailSender` over the given transport factory. A mail goes through the
 * saved SMTP server (KD-SEND-4); an unreachable server, a refused login or a
 * refused mail fails with `MailSenderError` (KD-SEND-6) and the message stays
 * free of the password (SET-VAL-4).
 */
export const makeMailSender = (
  createTransport: CreateTransport
): IMailSender => ({
  send: (mail: OutgoingMail) => deliver(createTransport, mail),
});

/** The SMTP sender backed by nodemailer (KD-SEND-4, KD-SEND-6). */
export const MailSenderLive: Layer.Layer<MailSender> = Layer.succeed(
  MailSender,
  makeMailSender((options) => nodemailer.createTransport(options))
);
