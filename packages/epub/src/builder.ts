import {
  type Ebook,
  type EbookChapter,
  EpubBuilder,
  EpubBuilderError,
} from '@reader/business';
import { Effect, Layer, Option, type Scope } from 'effect';
import { HttpClient } from 'effect/http';
import { type Zippable, zipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import {
  downloadImages,
  type EmbeddedImage,
  imageSources,
  rewriteImages,
} from './images';
import {
  containerXml,
  contentOpf,
  MIMETYPE,
  navXhtml,
  styleCss,
} from './package';
import { chapterDocument, serializeBody } from './xhtml';

type ChapterDocument = {
  readonly chapter: EbookChapter;
  readonly document: Document;
};

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Turns a synchronous failure into the port's error, whose message is safe to log (KD-SEND-5). */
const attempt = <A>(
  message: string,
  run: () => A
): Effect.Effect<A, EpubBuilderError> =>
  Effect.try({ try: run, catch: () => new EpubBuilderError({ message }) });

/**
 * Parses one chapter's sanitized HTML for the duration of the build, and
 * closes its window when the scope is released (KD-BOOK-5). A chapter with no
 * content is an empty body, so it still gets its heading and meta line
 * (KD-BOOK-3).
 */
const openChapter = (
  chapter: EbookChapter
): Effect.Effect<ChapterDocument, EpubBuilderError, Scope.Scope> => {
  const html = Option.getOrElse(chapter.content, () => '');

  return Effect.acquireRelease(
    attempt(
      'Unable to parse the article HTML',
      () => new JSDOM(`<!doctype html><body>${html}`)
    ),
    (dom) => Effect.sync(() => dom.window.close())
  ).pipe(Effect.map((dom) => ({ chapter, document: dom.window.document })));
};

/**
 * Assembles the archive: the stored mimetype first, then the container, the
 * package document, the navigation, the stylesheet, the chapters in reading
 * order and the embedded images (KD-BOOK-1, KD-BOOK-2, KD-BOOK-4).
 */
const zipBook = (
  book: Ebook,
  documents: ReadonlyArray<ChapterDocument>,
  images: ReadonlyArray<EmbeddedImage>
): Uint8Array => {
  const entries: Zippable = {
    mimetype: [encode(MIMETYPE), { level: 0 }],
    'META-INF/container.xml': encode(containerXml),
    'OEBPS/content.opf': encode(contentOpf(book, images)),
    'OEBPS/nav.xhtml': encode(navXhtml(book)),
    'OEBPS/style.css': encode(styleCss),
  };

  documents.forEach(({ chapter, document }, index) => {
    entries[`OEBPS/chapter-${index + 1}.xhtml`] = encode(
      chapterDocument(chapter, serializeBody(document))
    );
  });

  for (const image of images) {
    entries[`OEBPS/${image.path}`] = image.bytes;
  }

  return zipSync(entries);
};

/**
 * Builds one EPUB 3 file for the book (KD-BOOK): the chapters are parsed into
 * jsdom documents inside one scope, their images are downloaded sequentially
 * and rewritten (or all removed for a text-only book, KD-SPLIT-3), and
 * everything is zipped. Any unexpected failure becomes
 * `EpubBuilderError` (KD-SEND-5).
 */
const buildBook = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  book: Ebook
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const documents: Array<ChapterDocument> = [];

      for (const chapter of book.chapters) {
        documents.push(yield* openChapter(chapter));
      }

      const images = yield* downloadImages(
        client,
        book.images
          ? imageSources(documents.map(({ document }) => document))
          : []
      );

      return yield* attempt('Unable to build the EPUB', () => {
        for (const { document } of documents) {
          rewriteImages(document, images);
        }

        return zipBook(book, documents, Array.from(images.values()));
      });
    })
  );
});

/**
 * The EPUB 3 builder (KD-BOOK). It sends image requests through the
 * `HttpClient` of the environment, so the server decides how they reach the
 * network; a failed image never fails the book (KD-BOOK-4).
 */
export const EpubBuilderLive: Layer.Layer<
  EpubBuilder,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  EpubBuilder,
  Effect.map(HttpClient.HttpClient, (client) => ({
    build: (book: Ebook) => buildBook(client, book),
  }))
);
