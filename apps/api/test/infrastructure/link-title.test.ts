import { expect, it } from '@effect/vitest';
import {
  fetchLinkTitle,
  isPublicIPv4,
} from '../../src/infrastructure/link-title';

it('rejects internal and non-IPv4 metadata targets', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ]) {
    expect(isPublicIPv4(ip)).toBe(false);
  }

  expect(isPublicIPv4('8.8.8.8')).toBe(true);
  expect(await fetchLinkTitle('http://127.0.0.1/private')).toBe(
    'http://127.0.0.1/private'
  );
});
