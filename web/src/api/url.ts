// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
const CONTROL = /[\u0000-\u0020\u007f]/;

const SERVER_URL =
  /^https?:\/\/(?:\[[^[\]/?#@]+\]|[^[\]/?#@:]+)(?::(\d*))?(?:[/?#]|$)/i;

/**
 * Mirrors the server's accepted URL shape (`internal/domain/url.go`): http(s)
 * scheme, non-empty host, valid port (empty or 1..65535), no ASCII
 * whitespace/control characters, and no credentials (the server redacts them).
 * Deliberately does not use `new URL()`, which rejects inputs Go accepts such
 * as scoped IPv6 hosts (`http://[fe80::1%25eth0]/`).
 */
export const isServerHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || CONTROL.test(value)) return false;

  const match = SERVER_URL.exec(value);
  if (match === null) return false;

  const port = Number(match[1] || 1);

  return port >= 1 && port <= 65535;
};

/**
 * Returns `value` only when the browser can parse it, so links never render with
 * an href the browser would treat as relative or reject; otherwise `undefined`.
 */
export const browserHref = (value: string): string | undefined =>
  URL.canParse(value) ? value : undefined;
