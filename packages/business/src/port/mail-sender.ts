import type { Option } from 'effect';
import { Context, type Effect } from 'effect';
import type {
  EmailAddress,
  SmtpHost,
  SmtpPassword,
  SmtpPort,
  SmtpSecurity,
  SmtpUser,
} from '../entity/setting/kindle';
import type { MailSenderError } from '../error/kindle';

/** The SMTP server one mail goes through (SET-KINDLE-1). */
export type SmtpServer = {
  readonly host: SmtpHost;
  readonly port: SmtpPort;
  readonly security: SmtpSecurity;
  /** Login only when both the user and the password are given. */
  readonly user: Option.Option<SmtpUser>;
  readonly password: Option.Option<SmtpPassword>;
};

/** One mail with one attachment (KD-SEND-4). */
export type OutgoingMail = {
  readonly server: SmtpServer;
  readonly from: EmailAddress;
  readonly to: EmailAddress;
  readonly subject: string;
  readonly attachment: {
    readonly filename: string;
    readonly contentType: string;
    readonly content: Uint8Array;
  };
};

/**
 * Sends a mail through the given SMTP server (KD-SEND-4). Any failure,
 * connecting, authenticating or the server refusing, is `MailSenderError`,
 * whose message never carries the password (SET-VAL-4).
 */
export interface IMailSender {
  readonly send: (mail: OutgoingMail) => Effect.Effect<void, MailSenderError>;
}

export class MailSender extends Context.Service<MailSender, IMailSender>()(
  '@reader/business/MailSender'
) {}
