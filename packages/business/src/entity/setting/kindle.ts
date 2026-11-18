import { Schema } from 'effect';
import { OptionFromOptionalNonEmpty } from '../common/optional';

/** A trimmed address with one `@` and no whitespace (SET-KINDLE-1). */
export const EmailAddress = Schema.Trim.pipe(
  Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+$/)),
  Schema.brand('EmailAddress')
);

export type EmailAddress = typeof EmailAddress.Type;

/** The SMTP server's host name, trimmed and non-empty (SET-KINDLE-1). */
export const SmtpHost = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('SmtpHost')
);

export type SmtpHost = typeof SmtpHost.Type;

/** A TCP port, 1 to 65535 (SET-KINDLE-1). */
export const SmtpPort = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(65535)
  ),
  Schema.brand('SmtpPort')
);

export type SmtpPort = typeof SmtpPort.Type;

/** `tls` connects over TLS at once; `starttls` upgrades a plain connection (SET-KINDLE-1). */
export const SmtpSecurity = Schema.Literals(['tls', 'starttls']);

export type SmtpSecurity = typeof SmtpSecurity.Type;

/** The SMTP login name, trimmed and non-empty (SET-KINDLE-1). */
export const SmtpUser = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('SmtpUser')
);

export type SmtpUser = typeof SmtpUser.Type;

/**
 * The SMTP password: non-empty, kept as typed (not trimmed), and redacted like
 * the Jina key (SET-KINDLE-2, SET-VAL-4).
 */
export const SmtpPassword = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('SmtpPassword'),
  Schema.RedactedFromValue
);

export type SmtpPassword = typeof SmtpPassword.Type;

/**
 * The daily send time, `HH:MM` in 24-hour form on the hour or the half hour,
 * server-local (SET-KINDLE-1, KD-SCHED-1). The schedule only looks at whole
 * and half hours, so no other minute is a send time.
 */
export const SendTime = Schema.Trim.pipe(
  Schema.check(Schema.isPattern(/^([01]\d|2[0-3]):(00|30)$/)),
  Schema.brand('SendTime')
);

export type SendTime = typeof SendTime.Type;

/**
 * Where and how the unread articles are mailed (SET-KINDLE). Every field but
 * the login name and the send time is required; the password is stored beside
 * it on `Setting` because it is a secret (SET-KINDLE-2). No send time means no
 * scheduled sending; sending by hand still works (KD-SCHED-1).
 */
export const KindleDelivery = Schema.Struct({
  kindleEmail: EmailAddress,
  senderEmail: EmailAddress,
  smtpHost: SmtpHost,
  smtpPort: SmtpPort,
  smtpSecurity: SmtpSecurity,
  smtpUser: OptionFromOptionalNonEmpty(SmtpUser),
  sendTime: Schema.OptionFromOptional(SendTime),
});

export type KindleDelivery = typeof KindleDelivery.Type;
