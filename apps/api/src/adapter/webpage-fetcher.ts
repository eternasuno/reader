import { ArticleFailure, WebpageFetcher } from '@reader/business';
import { Effect, Layer, Redacted } from 'effect';
import { fetchPublicText } from '../infrastructure/http-fetch';

const failure = () =>
  new ArticleFailure({ error: 'Jina 获取失败，请检查 Key、额度及文章地址' });

const parseTarget = (url: string): URL => {
  const address = new URL(url);

  if (
    !['https:', 'http:'].includes(address.protocol) ||
    address.username ||
    address.password
  ) {
    throw new Error('Invalid URL');
  }

  return address;
};

export const WebpageFetcherLive = Layer.succeed(WebpageFetcher, {
  fetch: (url, key) =>
    Effect.gen(function* () {
      const address = yield* Effect.try({
        try: () => parseTarget(url),
        catch: failure,
      });
      const page = yield* fetchPublicText({
        url: `https://r.jina.ai/${address.href}`,
        headers: {
          Authorization: `Bearer ${Redacted.value(key)}`,
          'X-Return-Format': 'html',
          'X-Timeout': '30',
          Accept: 'text/html',
        },
        maxBytes: 5 * 1024 * 1024,
        maxRedirects: 0,
        redirect: 'error',
      });

      if (!page.ok) {
        return yield* failure();
      }

      return page.body;
    }).pipe(
      Effect.timeoutOrElse({
        duration: '40 seconds',
        orElse: () =>
          Effect.fail(
            new ArticleFailure({ error: '获取正文超时，请稍后重试' })
          ),
      }),
      Effect.catchTag('FetchFailure', () => Effect.fail(failure()))
    ),
});
