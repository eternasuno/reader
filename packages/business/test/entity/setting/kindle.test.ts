import { describe, expect, it } from '@effect/vitest';
import { Option, Redacted, Result, Schema } from 'effect';
import {
  EmailAddress,
  KindleDelivery,
  SendTime,
  SmtpPassword,
  SmtpPort,
  SmtpSecurity,
} from '../../../src/entity/setting/kindle';

const decodeEmail = Schema.decodeUnknownResult(EmailAddress);

const decodePort = Schema.decodeUnknownResult(SmtpPort);

const decodeSecurity = Schema.decodeUnknownResult(SmtpSecurity);

const decodeSendTime = Schema.decodeUnknownResult(SendTime);

const decodePassword = Schema.decodeUnknownResult(SmtpPassword);

const decodeDelivery = Schema.decodeUnknownResult(KindleDelivery);

const isInvalid = (result: Result.Result<unknown, unknown>): boolean =>
  Result.isFailure(result);

const delivery = {
  kindleEmail: 'kindle@example.com',
  senderEmail: 'sender@example.com',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpSecurity: 'tls',
};

describe('EmailAddress', () => {
  it('SET-KINDLE-1 trims the address', () => {
    for (const value of [
      '  kindle@example.com  ',
      '\tkindle@example.com ',
      ' kindle@example.com\n',
    ]) {
      expect(Result.getOrThrow(decodeEmail(value))).toBe('kindle@example.com');
    }
  });

  it('SET-KINDLE-1 rejects a blank address, no `@` and whitespace inside', () => {
    for (const value of ['', '   ', 'kindle', 'a b@c', 'a@b@c', 'a@']) {
      expect(isInvalid(decodeEmail(value))).toBe(true);
    }
  });
});

describe('SmtpPort', () => {
  it('SET-KINDLE-1 accepts the ports 1 to 65535', () => {
    for (const value of [1, 25, 465, 587, 65_535]) {
      expect(Result.getOrThrow(decodePort(value))).toBe(value);
    }
  });

  it('SET-KINDLE-1 rejects zero, above 65535 and non-integers', () => {
    for (const value of [0, -1, 65_536, 1.5, '465']) {
      expect(isInvalid(decodePort(value))).toBe(true);
    }
  });
});

describe('SmtpSecurity', () => {
  it('SET-KINDLE-1 accepts only tls and starttls', () => {
    expect(Result.getOrThrow(decodeSecurity('tls'))).toBe('tls');
    expect(Result.getOrThrow(decodeSecurity('starttls'))).toBe('starttls');

    for (const value of ['ssl', 'TLS', '', undefined]) {
      expect(isInvalid(decodeSecurity(value))).toBe(true);
    }
  });
});

describe('SendTime', () => {
  it('SET-KINDLE-1 accepts a time on the hour or the half hour and trims it', () => {
    for (const value of ['07:00', '07:30', '23:30', ' 07:30 ']) {
      expect(Result.getOrThrow(decodeSendTime(value))).toBe(value.trim());
    }
  });

  it('SET-KINDLE-1 rejects any other minute and a time outside the 24-hour form', () => {
    for (const value of [
      '07:15',
      '24:00',
      '7:00',
      '07:45',
      '23:59',
      '07:00:00',
      '',
    ]) {
      expect(isInvalid(decodeSendTime(value))).toBe(true);
    }
  });
});

describe('SmtpPassword', () => {
  it('SET-KINDLE-2 keeps the password as typed, without trimming', () => {
    const password = Result.getOrThrow(decodePassword('  secret  '));

    expect(Redacted.value(password)).toBe('  secret  ');
  });

  it('SET-KINDLE-2 rejects an empty password', () => {
    expect(isInvalid(decodePassword(''))).toBe(true);
  });

  it('SET-KINDLE-2 redacts the password in strings and in JSON', () => {
    const password = Result.getOrThrow(decodePassword('smtp-secret'));

    expect(Redacted.isRedacted(password)).toBe(true);
    expect(String(password)).not.toContain('smtp-secret');
    expect(JSON.stringify({ password })).not.toContain('smtp-secret');
  });
});

describe('KindleDelivery', () => {
  it('SET-KINDLE-1 a blank SMTP user decodes to none', () => {
    for (const value of ['', '   ', undefined]) {
      const decoded = Result.getOrThrow(
        decodeDelivery({ ...delivery, smtpUser: value })
      );

      expect(decoded.smtpUser).toStrictEqual(Option.none());
    }
  });

  it('SET-KINDLE-1 trims a given SMTP user', () => {
    const decoded = Result.getOrThrow(
      decodeDelivery({ ...delivery, smtpUser: '  login  ' })
    );

    expect(decoded.smtpUser).toStrictEqual(Option.some('login'));
  });

  it('SET-KINDLE-1 has no send time unless one is given', () => {
    const without = Result.getOrThrow(decodeDelivery(delivery));
    const withTime = Result.getOrThrow(
      decodeDelivery({ ...delivery, sendTime: '07:00' })
    );

    expect(without.sendTime).toStrictEqual(Option.none());
    expect(withTime.sendTime).toStrictEqual(Option.some('07:00'));
  });
});
