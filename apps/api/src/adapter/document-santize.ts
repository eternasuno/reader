import { DocumentSantize, DocumentSantizeError } from '@reader/business';
import { Effect, Layer } from 'effect';
import { cleanArticle } from '../infrastructure/article-sanitizer';

const sanitizeContent = (document: Document) => {
  cleanArticle(document, document.body.innerHTML);

  return document.body.innerHTML;
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
