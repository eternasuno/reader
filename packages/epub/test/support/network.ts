import { Effect, Layer } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';

/** A URL and a fresh answer for it; a fresh `Response` can be read once. */
export type Answers = ReadonlyMap<string, () => Response>;

/**
 * A stub network: every request is recorded and answered from the map, with a
 * 404 for an unknown URL. It verifies the builder's GET behavior without a
 * real server.
 */
export const networkStub = (answers: Answers) => {
  const requests: Array<string> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request.url);
      const answer = answers.get(request.url);

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          answer === undefined
            ? new Response('missing', { status: 404 })
            : answer()
        )
      );
    })
  );

  return { layer, requests };
};

export const goodImage = 'https://example.com/good.png';
export const missingImage = 'https://example.com/missing.png';
export const unsupportedImage = 'https://example.com/picture.svg';

/** The PNG magic bytes are all the builder reads (KD-BOOK-4). */
export const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const imageAnswers = (): Answers =>
  new Map([
    [goodImage, () => new Response(pngBytes, { status: 200 })],
    [missingImage, () => new Response('not found', { status: 404 })],
    [unsupportedImage, () => new Response('<svg />', { status: 200 })],
  ]);

export type NetworkStub = ReturnType<typeof networkStub>;
