import { LinkTitle } from '@reader/business';
import { Effect, Layer } from 'effect';
import { fetchLinkTitle } from '../infrastructure/link-title';

export const LinkTitleLive = Layer.succeed(LinkTitle, {
  fetch: (url) => Effect.promise(() => fetchLinkTitle(url)),
});
