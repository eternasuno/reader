import {
  DocumentSantize,
  DocumentSantizeError,
  OptionFromOptionalNonEmpty,
} from '@reader/business';
import { Effect, Layer, Schema } from 'effect';
import { cleanArticle } from '../infrastructure/article-sanitizer';

const decodeContent = Schema.decodeSync(
  OptionFromOptionalNonEmpty(Schema.Trim)
);

const sanitizeContent = (document: Document) => {
  cleanArticle(document, document.body.innerHTML);

  return decodeContent(document.body.innerHTML);
};

export const DocumentSantizeLive = Layer.succeed(DocumentSantize, {
  sanitize: (document) =>
    Effect.try({
      try: () => sanitizeContent(document),
      catch: () =>
        new DocumentSantizeError({
          message: 'Failed to sanitize article content',
        }),
    }),
});
