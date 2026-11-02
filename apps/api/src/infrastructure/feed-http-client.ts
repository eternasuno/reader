import { Agent } from '@effect/platform-node/Undici';
import {
  HttpFetchLive,
  publicAddressLookup,
  validatePublicTarget,
} from '@reader/webpage/http';
import { Context, Effect, Layer } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientError } from 'effect/http';

const configured = (
  transport: HttpClient.HttpClient,
  dispatcher: Agent
): HttpClient.HttpClient =>
  HttpClient.transform(transport, (effect, request) =>
    Effect.gen(function* () {
      yield* validatePublicTarget(request.url).pipe(
        Effect.mapError(
          (failure) =>
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                cause: failure,
              }),
            })
        )
      );

      return yield* effect.pipe(
        Effect.provideService(FetchHttpClient.RequestInit, {
          dispatcher,
          redirect: 'manual',
        } as globalThis.RequestInit)
      );
    })
  );

export const FeedHttpClientLive: Layer.Layer<HttpClient.HttpClient> =
  FetchHttpClient.layer.pipe(
    Layer.provide(HttpFetchLive),
    Layer.flatMap((context) =>
      Layer.effect(
        HttpClient.HttpClient,
        Effect.gen(function* () {
          const transport = Context.get(context, HttpClient.HttpClient);
          const dispatcher = yield* Effect.acquireRelease(
            Effect.sync(
              () =>
                new Agent({
                  connect: { family: 4, lookup: publicAddressLookup },
                })
            ),
            (agent) => Effect.promise(() => agent.destroy())
          );

          return configured(transport, dispatcher);
        })
      )
    )
  );
