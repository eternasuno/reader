import { ArticleFailure, WebpageFetcher } from '@reader/business';
import { Effect, Layer, Redacted } from 'effect';

const collect = async (response: Response): Promise<string> => {
  if (!response.ok || !response.body) {
    throw new Error('Request rejected');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      size += result.value.length;
      if (size > 5 * 1024 * 1024) {
        throw new Error('HTML too large');
      }

      chunks.push(result.value);
    }

    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel();
  }
};

export const WebpageFetcherLive = Layer.succeed(WebpageFetcher, {
  fetch: (url, key) =>
    Effect.tryPromise({
      try: async (signal) => {
        const address = new URL(url);
        if (
          !['https:', 'http:'].includes(address.protocol) ||
          address.username ||
          address.password
        ) {
          throw new Error('Invalid URL');
        }

        const response = await fetch(`https://r.jina.ai/${address.href}`, {
          signal,
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${Redacted.value(key)}`,
            'X-Return-Format': 'html',
            'X-Timeout': '30',
            Accept: 'text/html',
          },
        });

        return collect(response);
      },
      catch: () =>
        new ArticleFailure({
          error: 'Jina 获取失败，请检查 Key、额度及文章地址',
        }),
    }).pipe(
      Effect.timeout('40 seconds'),
      Effect.catchTag('TimeoutError', () =>
        Effect.fail(new ArticleFailure({ error: '获取正文超时，请稍后重试' }))
      )
    ),
});
