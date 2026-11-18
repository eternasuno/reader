import { expect, it } from '@effect/vitest';
import {
  EmailAddress,
  MailSender,
  type OutgoingMail,
  SmtpHost,
  SmtpPassword,
  SmtpPort,
  type SmtpSecurity,
  type SmtpServer,
  SmtpUser,
} from '@reader/business';
import { Effect, Layer, Option, Redacted, Schema } from 'effect';
import type { SendMailOptions } from 'nodemailer';
import {
  type CreateTransport,
  makeMailSender,
  type TransportOptions,
} from '../src/mail-sender';

const secret = 'smtp-secret-password';

const decode = {
  address: Schema.decodeSync(EmailAddress),
  host: Schema.decodeSync(SmtpHost),
  port: Schema.decodeSync(SmtpPort),
  user: Schema.decodeSync(SmtpUser),
  password: Schema.decodeSync(SmtpPassword),
};

const password = decode.password(secret);

const server = (
  security: SmtpSecurity,
  login: {
    readonly user: Option.Option<SmtpUser>;
    readonly password: Option.Option<SmtpPassword>;
  } = { user: Option.none(), password: Option.none() }
): SmtpServer => ({
  host: decode.host('smtp.example.com'),
  port: decode.port(465),
  security,
  ...login,
});

const book = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const mail = (smtp: SmtpServer): OutgoingMail => ({
  server: smtp,
  from: decode.address('sender@example.com'),
  to: decode.address('kindle@example.com'),
  subject: '留白 2026-11-18',
  attachment: {
    filename: 'liubai-2026-11-18.epub',
    contentType: 'application/epub+zip',
    content: book,
  },
});

type Recorder = {
  options?: TransportOptions;
  message?: SendMailOptions;
  closes: number;
};

type Fake = {
  readonly createTransport: CreateTransport;
  readonly record: Recorder;
};

const fake = (send: () => Promise<unknown>): Fake => {
  const record: Recorder = { closes: 0 };

  return {
    record,
    createTransport: (options) => {
      record.options = options;

      return {
        sendMail: (message) => {
          record.message = message;

          return send();
        },
        close: () => {
          record.closes += 1;
        },
      };
    },
  };
};

const succeeds = () => Promise.resolve({ accepted: ['kindle@example.com'] });

const send = (target: OutgoingMail, createTransport: CreateTransport) =>
  Effect.flatMap(MailSender, (sender) => sender.send(target)).pipe(
    Effect.provide(Layer.succeed(MailSender, makeMailSender(createTransport)))
  );

it.effect('KD-SEND-4 uses TLS from the start for `tls`', () =>
  Effect.gen(function* () {
    const smtp = fake(succeeds);
    yield* send(mail(server('tls')), smtp.createTransport);

    expect(smtp.record.options?.secure).toBe(true);
    expect(smtp.record.options?.requireTLS).toBe(false);
  })
);

it.effect('KD-SEND-4 upgrades a plain connection for `starttls`', () =>
  Effect.gen(function* () {
    const smtp = fake(succeeds);
    yield* send(mail(server('starttls')), smtp.createTransport);

    expect(smtp.record.options?.secure).toBe(false);
    expect(smtp.record.options?.requireTLS).toBe(true);
  })
);

it.effect('KD-SEND-4 logs in only with both the user and the password', () =>
  Effect.gen(function* () {
    const both = fake(succeeds);
    yield* send(
      mail(
        server('tls', {
          user: Option.some(decode.user('reader')),
          password: Option.some(password),
        })
      ),
      both.createTransport
    );

    expect(both.record.options?.auth).toEqual({
      user: 'reader',
      pass: Redacted.value(password),
    });

    const userOnly = fake(succeeds);
    yield* send(
      mail(
        server('tls', {
          user: Option.some(decode.user('reader')),
          password: Option.none(),
        })
      ),
      userOnly.createTransport
    );

    expect(userOnly.record.options && 'auth' in userOnly.record.options).toBe(
      false
    );
  })
);

it.effect('KD-SEND-4 mails the book as one attachment', () =>
  Effect.gen(function* () {
    const smtp = fake(succeeds);
    const target = mail(server('tls'));
    yield* send(target, smtp.createTransport);

    expect(smtp.record.message?.from).toBe(target.from);
    expect(smtp.record.message?.to).toBe(target.to);
    expect(smtp.record.message?.subject).toBe('留白 2026-11-18');
    expect(smtp.record.message?.attachments).toEqual([
      {
        filename: 'liubai-2026-11-18.epub',
        contentType: 'application/epub+zip',
        content: Buffer.from(book),
      },
    ]);
  })
);

it.effect('KD-SEND-6 closes the transport after a sent mail', () =>
  Effect.gen(function* () {
    const smtp = fake(succeeds);
    yield* send(mail(server('tls')), smtp.createTransport);

    expect(smtp.record.closes).toBe(1);
  })
);

it.effect('KD-SEND-6 closes the transport after a refused mail', () =>
  Effect.gen(function* () {
    const smtp = fake(() => Promise.reject(new Error('refused')));
    yield* Effect.flip(send(mail(server('tls')), smtp.createTransport));

    expect(smtp.record.closes).toBe(1);
  })
);

it.effect('KD-SEND-6 names the code but never the password', () =>
  Effect.gen(function* () {
    const refused = Object.assign(
      new Error(`535 authentication failed for ${secret}`),
      { code: 'EAUTH', responseCode: 535 }
    );
    const smtp = fake(() => Promise.reject(refused));
    const failure = yield* Effect.flip(
      send(mail(server('tls')), smtp.createTransport)
    );

    expect(failure._tag).toBe('MailSenderError');
    expect(failure.message).toContain('EAUTH');
    expect(failure.message).toContain('535');
    expect(failure.message).not.toContain(secret);
    expect(failure.message).not.toContain('authentication failed');
  })
);

it.effect('SET-VAL-4 reports a failure without codes plainly', () =>
  Effect.gen(function* () {
    const smtp = fake(() =>
      Promise.reject(new Error(`login ${secret} rejected`))
    );
    const failure = yield* Effect.flip(
      send(mail(server('tls')), smtp.createTransport)
    );

    expect(failure.message).toBe('SMTP send failed');
    expect(failure.message).not.toContain(secret);
  })
);
