import { expect, it } from '@effect/vitest';
import {
  ArticleExtractor,
  FeedItemRepository,
  FeedRepository,
  HtmlParser,
  type OwnerId,
  SavedPageRepository,
  SettingRepository,
  SettingRepositoryError,
} from '@reader/business';
import { alice, bob } from '@reader/business/testing';
import { Deferred, Effect, Fiber, Layer, Queue } from 'effect';
import { HttpClient } from 'effect/http';
import { KindleSender } from '../../../src/server/kindle/sender';
import { KindleSenderLive } from '../../../src/server/kindle/sender-live';

/**
 * The setting read holds a send open until the test releases the gate, so a
 * second request arrives while the first one runs (KD-SEND-7). Every send then
 * fails at that read, which touches no other port.
 */
const gatedSettings = (
  gate: Deferred.Deferred<void>,
  entered: Queue.Queue<OwnerId>
) =>
  Layer.mock(SettingRepository, {
    get: (owner) =>
      Effect.gen(function* () {
        yield* Queue.offer(entered, owner);
        yield* Deferred.await(gate);

        return yield* new SettingRepositoryError({ message: 'gated' });
      }),
  });

/** Every port a send may touch, none of them implemented (KD-SEND). */
const environment = (settings: Layer.Layer<SettingRepository>) =>
  Layer.mergeAll(
    settings,
    Layer.mock(FeedRepository, {}),
    Layer.mock(FeedItemRepository, {}),
    Layer.mock(SavedPageRepository, {}),
    Layer.mock(HtmlParser, {}),
    Layer.mock(ArticleExtractor, {}),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() =>
        Effect.die(new Error('a send here fetches nothing'))
      )
    )
  );

/** The tag a send fails with (`Effect.flip` makes the failure the result). */
const failureOf = (send: Effect.Effect<unknown, { readonly _tag: string }>) =>
  Effect.map(send.pipe(Effect.flip), (error) => error._tag);

/**
 * Runs a body with the sender over the gate. The body shares the gate and the
 * queue with the layer, so it releases the gate when it has seen enough.
 */
const withGate = <A, E>(
  body: (
    gate: Deferred.Deferred<void>,
    entered: Queue.Queue<OwnerId>
  ) => Effect.Effect<A, E, KindleSender>
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const entered = yield* Queue.unbounded<OwnerId>();
    const senderLayer = KindleSenderLive.pipe(
      Layer.provide(environment(gatedSettings(gate, entered)))
    );

    return yield* body(gate, entered).pipe(Effect.provide(senderLayer));
  });

it.effect(
  'KD-SEND-7 a second send of the same owner fails while one runs',
  () =>
    withGate((gate, entered) =>
      Effect.gen(function* () {
        const sender = yield* KindleSender;
        const first = yield* sender.send(alice).pipe(Effect.forkChild);

        expect(yield* Queue.take(entered)).toBe(alice);
        expect(yield* failureOf(sender.send(alice))).toBe(
          'KindleSendInProgress'
        );

        yield* Deferred.succeed(gate, undefined);

        expect(yield* failureOf(Fiber.join(first))).toBe(
          'SettingRepositoryError'
        );
      })
    )
);

it.effect('KD-SEND-7 sends of different owners run at the same time', () =>
  withGate((gate, entered) =>
    Effect.gen(function* () {
      const sender = yield* KindleSender;
      const first = yield* sender.send(alice).pipe(Effect.forkChild);

      expect(yield* Queue.take(entered)).toBe(alice);

      const second = yield* sender.send(bob).pipe(Effect.forkChild);

      expect(yield* Queue.take(entered)).toBe(bob);

      yield* Deferred.succeed(gate, undefined);

      for (const fiber of [first, second]) {
        expect(yield* failureOf(Fiber.join(fiber))).toBe(
          'SettingRepositoryError'
        );
      }
    })
  )
);

it.effect('KD-SEND-7 the owner is released after its send ends', () =>
  withGate((gate, entered) =>
    Effect.gen(function* () {
      const sender = yield* KindleSender;

      yield* Deferred.succeed(gate, undefined);

      expect(yield* failureOf(sender.send(alice))).toBe(
        'SettingRepositoryError'
      );
      expect(yield* failureOf(sender.send(alice))).toBe(
        'SettingRepositoryError'
      );
      expect(yield* Queue.size(entered)).toBe(2);
    })
  )
);
