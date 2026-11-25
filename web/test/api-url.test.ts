import { describe, expect, it } from 'vitest';
import { isServerHttpUrl } from '../src/api/url';

describe('isServerHttpUrl', () => {
  it.each([
    'http://example.com',
    'https://example.com:8443/a?b=c',
    'http://127.0.0.1:1/x',
    'http://127.0.0.1:65535/x',
    'http://127.0.0.1:8080/x',
    'http://127.0.0.1:080/x',
    'http://host:/',
    'http://[::1]:8080/',
    'http://[fe80::1%25eth0]/feed',
    'http://[fe80::1%eth0]/feed',
    'https://example.cn/s?q=a\u3000b',
    'https://example.cn/s?q=a\u00a0b',
    'https://example.cn/s?q=a\ufeffb',
  ])('accepts %s', (value) => expect(isServerHttpUrl(value)).toBe(true));

  it.each([
    '',
    'ftp://example.com',
    'javascript:alert(1)',
    'https://user:pass@example.com',
    'https:///path',
    'http://[]/',
    'http://[::1/',
    'http://[::1]x/',
    'http://[::1]:99999/',
    'http://127.0.0.1:99999/x',
    'http://127.0.0.1:0/x',
    'http://127.0.0.1:65536/x',
    'http://127.0.0.1:abc/x',
    'http://exa mple.com',
    'https://example.cn/s?q=a b',
    'https://example.cn/s?q=a\u0000b',
    'https://example.cn/s?q=a\u001bb',
    'https://example.cn/s?q=a\u007fb',
    '/relative',
  ])('rejects %s', (value) => expect(isServerHttpUrl(value)).toBe(false));
});
