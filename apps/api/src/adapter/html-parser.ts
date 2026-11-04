import { HtmlParser, HtmlParserError } from '@reader/business';
import { Effect, Layer } from 'effect';
import { JSDOM } from 'jsdom';

const acquireDocument = (html: string, url?: URL) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => new JSDOM(html, url === undefined ? {} : { url: url.href }),
      catch: () =>
        new HtmlParserError({ message: 'Unable to parse HTML content' }),
    }),
    (dom) => Effect.sync(() => dom.window.close())
  );

const parse = (html: string, url?: URL) =>
  Effect.map(acquireDocument(html, url), (dom) => dom.window.document);

export const HtmlParserLive = Layer.succeed(HtmlParser, { parse });
