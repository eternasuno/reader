import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Config, Context, Effect, Layer, Redacted } from 'effect';

export class CredentialCrypto extends Context.Service<
  CredentialCrypto,
  {
    encrypt: (owner: string, value: string) => string;
    decrypt: (owner: string, value: string) => string;
  }
>()('CredentialCrypto') {}

const encrypt = (key: Buffer, owner: string, value: string): string => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  return [
    'v1',
    nonce.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
};

const decrypt = (key: Buffer, owner: string, value: string): string => {
  const [version, nonce, tag, content] = value.split('.');
  if (version !== 'v1' || !nonce || !tag || !content) {
    throw new Error('Invalid encrypted credential');
  }

  const cipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(nonce, 'base64')
  );
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    cipher.update(Buffer.from(content, 'base64')),
    cipher.final(),
  ]).toString('utf8');
};

export const CredentialCryptoLive = Layer.effect(
  CredentialCrypto,
  Effect.gen(function* () {
    const secret = yield* Config.Redacted('READER_ENCRYPTION_KEY').pipe(
      Config.withDefault(Redacted.make(''))
    );
    const key = Buffer.from(Redacted.value(secret), 'base64');
    const requireKey = () => {
      if (key.length !== 32) {
        throw new Error(
          'READER_ENCRYPTION_KEY must contain 32 random bytes in base64'
        );
      }
    };

    return {
      encrypt: (owner, value) => {
        requireKey();

        return encrypt(key, owner, value);
      },
      decrypt: (owner, value) => {
        requireKey();

        return decrypt(key, owner, value);
      },
    };
  })
);
