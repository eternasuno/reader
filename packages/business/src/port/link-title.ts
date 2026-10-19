import { Context, type Effect } from 'effect';

export class LinkTitle extends Context.Service<
  LinkTitle,
  {
    readonly fetch: (url: string) => Effect.Effect<string>;
  }
>()('@reader/business/LinkTitle') {}
