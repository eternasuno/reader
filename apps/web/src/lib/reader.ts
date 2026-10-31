import { Cause, Effect } from 'effect';
import { AsyncResult, Atom } from 'effect/reactivity';
import { LinksClient, LinksClientLive } from './links';

export const readerError = (
  result: AsyncResult.AsyncResult<unknown, unknown>
): string => {
  if (!AsyncResult.isFailure(result)) {
    return '';
  }

  const error = Cause.squash(result.cause);

  return error &&
    typeof error === 'object' &&
    'error' in error &&
    typeof error.error === 'string'
    ? error.error
    : '操作失败，请稍后重试';
};

export const makeReaderAtoms = (kind: 'link' | 'feed', key: string) => {
  const runtime = Atom.runtime(LinksClientLive);
  const content = runtime.atom(() =>
    Effect.flatMap(LinksClient, (client) =>
      client.reader.content({ query: { kind, key } })
    )
  );
  const extract = runtime.fn<boolean>()(
    Effect.fnUntraced(function* (refresh, get) {
      const client = yield* LinksClient;
      yield* client.reader.extract({ payload: { kind, key, refresh } });
      get.refresh(content);
    })
  );

  return { content, extract };
};

export type ReaderProvider = 'jina' | 'browser';

export type SettingsCommand =
  | { readonly _tag: 'Key'; readonly key: string }
  | { readonly _tag: 'DeleteKey' }
  | { readonly _tag: 'BrowserEndpoint'; readonly endpoint: string }
  | { readonly _tag: 'Provider'; readonly provider: ReaderProvider };

export const toReaderProvider = (value: string): ReaderProvider | undefined =>
  value === 'jina' || value === 'browser' ? value : undefined;

export const makeSettingsAtoms = (layer = LinksClientLive) => {
  const runtime = Atom.runtime(layer);
  const status = runtime.atom(() =>
    Effect.flatMap(LinksClient, (client) => client.reader.settings())
  );
  const update = runtime.fn<SettingsCommand>()(
    Effect.fnUntraced(function* (command, get) {
      const client = yield* LinksClient;

      if (command._tag === 'Key') {
        yield* client.reader.setKey({ payload: { key: command.key } });
      } else if (command._tag === 'DeleteKey') {
        yield* client.reader.deleteKey();
      } else if (command._tag === 'BrowserEndpoint') {
        yield* client.reader.setBrowserEndpoint({
          payload: { endpoint: command.endpoint },
        });
      } else {
        yield* client.reader.setProvider({
          payload: { provider: command.provider },
        });
      }

      get.refresh(status);
    })
  );

  return { status, update };
};
