import { expect } from '@effect/vitest';
import type { Ebook } from '@reader/business';
import { EpubBuilder } from '@reader/business';
import { Effect, Layer } from 'effect';
import { type Unzipped, unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { EpubBuilderLive } from '../../src/index';
import type { NetworkStub } from './network';

/** Builds through the port, exactly as the server would (KD-BOOK-1). */
export const buildOf = (book: Ebook, network: NetworkStub) =>
  Effect.flatMap(EpubBuilder, (builder) => builder.build(book)).pipe(
    Effect.provide(Layer.provide(EpubBuilderLive, network.layer))
  );

export const unzip = (bytes: Uint8Array): Unzipped => unzipSync(bytes);

export const entryBytes = (files: Unzipped, path: string): Uint8Array => {
  const bytes = files[path];

  if (bytes === undefined) {
    throw new Error(`The archive has no ${path}`);
  }

  return bytes;
};

export const entryText = (files: Unzipped, path: string): string =>
  new TextDecoder().decode(entryBytes(files, path));

/**
 * Parses a document as XHTML/XML and fails when the parser reports an error,
 * so a chapter or the navigation that is not well-formed XML never passes.
 */
export const withXml = <A>(
  source: string,
  use: (document: Document) => A
): A => {
  const dom = new JSDOM(source, { contentType: 'application/xhtml+xml' });

  try {
    expect(dom.window.document.querySelector('parsererror')).toBeNull();

    return use(dom.window.document);
  } finally {
    dom.window.close();
  }
};
