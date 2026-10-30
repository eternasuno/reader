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

export const makeSettingsAtoms = () => {
  const runtime = Atom.runtime(LinksClientLive);
  const status = runtime.atom(() =>
    Effect.flatMap(LinksClient, (client) => client.reader.settings())
  );
  const update = runtime.fn<string | null>()(
    Effect.fnUntraced(function* (key, get) {
      const client = yield* LinksClient;
      if (key === null) {
        yield* client.reader.deleteKey();
      } else {
        yield* client.reader.setKey({ payload: { key } });
      }

      get.refresh(status);
    })
  );

  return { status, update };
};
