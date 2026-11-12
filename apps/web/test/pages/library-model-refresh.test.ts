// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped reload cases stay together with their shared client fixture.
import { describe, expect, it } from 'vitest';
import { createLibraryModel } from '../../src/pages/library-model';
import {
  article,
  counts,
  createStubClient,
  deferred,
  page,
} from './library-fixtures';

const loaded = async (rows = [article('a'), article('b')]) => {
  const client = createStubClient();
  client.list.mockResolvedValue(page(rows, null));
  client.unreadCounts.mockResolvedValue(counts(0));
  const model = createLibraryModel(client);
  await model.refresh();

  return { client, model };
};

describe('library reload', () => {
  it('reloads the current list from its first page and reloads counts', async () => {
    const { client, model } = await loaded();
    client.list.mockResolvedValue(page([article('c')]));
    client.unreadCounts.mockResolvedValue(counts(2));

    await model.refresh();

    expect(client.list).toHaveBeenLastCalledWith({ kind: 'later' }, false);
    expect(model.state().items.map((item) => item.id)).toEqual(['c']);
    expect(model.state().cursor).toBeNull();
    expect(client.unreadCounts).toHaveBeenCalledTimes(2);
    expect(model.state().counts).toEqual(counts(2));
  });

  it('reloads the selected feed list without a cursor', async () => {
    const { client, model } = await loaded();
    client.list.mockResolvedValue(page([article('f', { feedId: 'f1' })]));
    await model.setScope({ kind: 'feeds', feedId: 'f1' });

    client.list.mockResolvedValue(
      page([article('g', { feedId: 'f1' })], 'cursor-3')
    );
    await model.refresh();

    expect(client.list).toHaveBeenLastCalledWith(
      { kind: 'feeds', feedId: 'f1' },
      false
    );
    expect(model.state().items.map((item) => item.id)).toEqual(['g']);
  });

  it('ignores a refresh while a read mark is in flight', async () => {
    const { client, model } = await loaded([article('a')]);
    const mark = deferred<void>();
    client.markRead.mockReturnValue(mark.promise);
    const pending = model.toggleRead(model.state().items[0] ?? article('a'));

    client.list.mockResolvedValue(page([article('b')]));
    await model.refresh();

    expect(client.list).toHaveBeenCalledTimes(1);
    expect(model.state().items.map((item) => item.id)).toEqual(['a']);

    mark.resolve();
    await pending;
  });

  it('ignores a refresh while a delete is in flight', async () => {
    const { client, model } = await loaded();
    const remove = deferred<void>();
    client.remove.mockReturnValue(remove.promise);
    const pending = model.remove(model.state().items[0] ?? article('a'));

    await model.refresh();

    expect(client.list).toHaveBeenCalledTimes(1);
    expect(model.state().items.map((item) => item.id)).toEqual(['b']);

    remove.resolve();
    await pending;
  });

  it('ignores a refresh while a whole-scope mark is in flight', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a', { read: true })]));
    client.unreadCounts.mockResolvedValue(counts(3));
    const model = createLibraryModel(client);
    await model.refresh();
    const mark = deferred<void>();
    client.markLater.mockReturnValue(mark.promise);

    const pending = model.markAll();
    expect(client.markLater).toHaveBeenCalledTimes(1);

    await model.markAll();
    expect(client.markLater).toHaveBeenCalledTimes(1);

    await model.refresh();
    expect(client.list).toHaveBeenCalledTimes(1);

    mark.resolve();
    await pending;

    await model.refresh();
    expect(client.list).toHaveBeenCalledTimes(2);
  });

  it('reloads on entering the library even for the default scope', async () => {
    const client = createStubClient();
    client.list.mockResolvedValue(page([article('a')]));
    const model = createLibraryModel(client);

    await model.enter({ kind: 'later' });

    expect(client.list).toHaveBeenCalledWith({ kind: 'later' }, false);
    expect(model.state().items.map((item) => item.id)).toEqual(['a']);
  });
});
