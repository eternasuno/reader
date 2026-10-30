import { LinkTitle } from '@reader/business';
import { Effect, Layer } from 'effect';
import { fetchLinkTitle } from '../infrastructure/link-title';

export const LinkTitleLive = Layer.succeed(LinkTitle, {
  fetch: (url) =>
    fetchLinkTitle(url).pipe(
      Effect.timeoutOrElse({
        duration: '5 seconds',
        orElse: () => Effect.succeed(''),
      }),
      Effect.orElseSucceed(() => ''),
      Effect.map((title) => title || url)
    ),
});
