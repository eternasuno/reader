const decodeComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const hasAuthorization = (headers: Record<string, string>): boolean =>
  Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');

export const stripCredentials = (
  url: URL
): { readonly url: URL; readonly authorization: string | undefined } => {
  if (url.username === '' && url.password === '') {
    return { url, authorization: undefined };
  }

  const target = new URL(url.href);
  const credentials = `${decodeComponent(target.username)}:${decodeComponent(target.password)}`;
  target.username = '';
  target.password = '';

  return {
    url: target,
    authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
  };
};

export const withBasicAuthorization = (
  headers: Record<string, string>,
  authorization: string | undefined
): Record<string, string> =>
  authorization === undefined || hasAuthorization(headers)
    ? headers
    : { ...headers, authorization };
