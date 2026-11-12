// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: grouped reload cases stay together with their shared client fixture.
import { describe, expect, it } from 'vitest';
import type { Article } from '../../src/lib/library';
import {
  createLibraryModel,
  type LibraryModel,
} from '../../src/pages/library-model';
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

type StubClient = ReturnType<typeof createStubClient>;
type Gate = ReturnType<typeof deferred<void>>;

type BusyCase = {
  readonly name: string;
  readonly rows: ReadonlyArray<Article>;
  readonly block: (client: StubClient, gate: Gate) => void;
  readonly act: (model: LibraryModel) => Promise<unknown>;
  readonly expectedIds: ReadonlyArray<string>;
};

const busyCases: ReadonlyArray<BusyCase> = [
  {
    name: 'a read mark',
    rows: [article('a')],
    block: (client, gate) => client.markRead.mockReturnValue(gate.promise),
    act: (model) => model.toggleRead(model.state().items[0] ?? article('a')),
    expectedIds: ['a'],
  },
  {
    name: 'a delete',
    rows: [article('a'), article('b')],
    block: (client, gate) => client.remove.mockReturnValue(gate.promise),
    act: (model) => model.remove(model.state().items[0] ?? article('a')),
    expectedIds: ['b'],
  },
  {
    name: 'a whole-scope mark',
    rows: [article('a')],
    block: (client, gate) => client.markLater.mockReturnValue(gate.promise),
    act: (model) => model.markAll(),
    expectedIds: ['a'],
  },
];

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

  it('ignores a refresh while a write is in flight', async () => {
    for (const testCase of busyCases) {
      const client = createStubClient();
      client.list.mockResolvedValue(page(testCase.rows, null));
      client.unreadCounts.mockResolvedValue(counts(0));
      const model = createLibraryModel(client);
      await model.refresh();

      const gate = deferred<void>();
      testCase.block(client, gate);
      const pending = testCase.act(model);

      await model.refresh();

      expect(
        client.list,
        `refresh during ${testCase.name}`
      ).toHaveBeenCalledTimes(1);
      expect(model.state().items.map((item) => item.id)).toEqual(
        testCase.expectedIds
      );

      gate.resolve();
      await pending;

      await model.refresh();
      expect(
        client.list,
        `refresh after ${testCase.name}`
      ).toHaveBeenCalledTimes(2);
    }
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
