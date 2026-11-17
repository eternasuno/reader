import { HtmlDocument, HtmlParser, HtmlParserError } from '@reader/business';
import { Effect, Layer } from 'effect';
import { JSDOM } from 'jsdom';

/**
 * The parsed document is a jsdom document. HtmlParser is its only producer, so
 * this is the one place that knows the concrete type.
 */
export const documentOf = (document: HtmlDocument): Document =>
  document as unknown as Document;

const open = (html: string, url: URL) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => new JSDOM(html, { url: url.href }),
      catch: () => new HtmlParserError({ message: 'Unable to parse the HTML' }),
    }),
    (dom) => Effect.sync(() => dom.window.close())
  );

/** The document lives in the caller's scope and the window closes with it. */
export const parse = Effect.fn('HtmlParser.parse')(function* (
  html: string,
  url: URL
) {
  const dom = yield* open(html, url);

  return HtmlDocument.make(dom.window.document);
});

export const HtmlParserLive = Layer.succeed(HtmlParser, { parse });
