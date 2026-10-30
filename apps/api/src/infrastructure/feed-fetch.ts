import { Effect } from 'effect';
import { FetchFailure, fetchPublicText } from './http-fetch';

export type FeedDocument = { readonly content: string; readonly url: string };

const isFeedResponse = (status: number, encoding: string | undefined) =>
  status === 200 && (!encoding || encoding === 'identity');

export const fetchFeed = (
  url: string
): Effect.Effect<FeedDocument, FetchFailure> =>
  Effect.flatMap(
    fetchPublicText({
      url,
      headers: {
        accept:
          'application/rss+xml, application/atom+xml, application/xml, text/xml',
        'accept-encoding': 'identity',
        'user-agent': 'ReadLater/1.0',
      },
      maxBytes: 2 * 1024 * 1024,
      maxRedirects: 3,
    }),
    (page) =>
      isFeedResponse(page.status, page.headers['content-encoding'])
        ? Effect.succeed({ content: page.body, url: page.url })
        : Effect.fail(new FetchFailure({ message: 'Feed request failed' }))
  );
