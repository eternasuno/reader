import { describe, expect, it } from '@effect/vitest';
import { Option, Result, Schema } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
  ExtractedArticle,
} from '../../../src/entity/common/article';
import { OptionFromOptionalNonEmpty } from '../../../src/entity/common/optional';

const decodeTitle = Schema.decodeUnknownSync(ArticleTitle);

const decodeDescription = Schema.decodeUnknownSync(
  OptionFromOptionalNonEmpty(ArticleDescription)
);

const decodeContent = Schema.decodeUnknownSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

describe('ArticleTitle', () => {
  it('CM-ART-1 trims the title', () => {
    expect(decodeTitle('  Hello world  ')).toBe('Hello world');
    expect(decodeTitle('\nHello world\t')).toBe('Hello world');
  });

  it('CM-ART-1 turns an empty title into Untitled', () => {
    expect(decodeTitle('')).toBe('Untitled');
    expect(decodeTitle('   ')).toBe('Untitled');
  });
});

describe('ArticleDescription and ArticleContent', () => {
  it('CM-ART-2 trims both ends and keeps the inner text', () => {
    const description = Result.getOrThrow(
      Schema.decodeResult(ArticleDescription)('  <p>about</p>  ')
    );
    const content = Result.getOrThrow(
      Schema.decodeResult(ArticleContent)('  <p>body</p>  ')
    );

    expect(description).toBe('<p>about</p>');
    expect(content).toBe('<p>body</p>');
  });

  it('CM-ART-3 turns absent text into none', () => {
    expect(Option.isNone(decodeDescription(undefined))).toBe(true);
    expect(Option.isNone(decodeContent(undefined))).toBe(true);
  });

  it('CM-ART-3 turns blank text into none', () => {
    expect(Option.isNone(decodeDescription(''))).toBe(true);
    expect(Option.isNone(decodeDescription('   '))).toBe(true);
    expect(Option.isNone(decodeContent('  '))).toBe(true);
  });
});

describe('ExtractedArticle', () => {
  it('CM-FETCH-1 reports a missing publish time as none', () => {
    const article = Schema.decodeSync(ExtractedArticle)({
      title: 'Post',
      content: '<p>body</p>',
    });

    expect(Option.isNone(article.publishedAt)).toBe(true);
    expect(Option.isNone(article.description)).toBe(true);
  });

  it('CM-ART-4 carries the sanitized description and content the adapter produced', () => {
    const article = Schema.decodeSync(ExtractedArticle)({
      title: '  Post  ',
      description: ' <p>about</p> ',
      content: ' <p>body</p> ',
    });

    expect(article.title).toBe('Post');
    expect(article.description).toEqual(Option.some('<p>about</p>'));
    expect(article.content).toEqual(Option.some('<p>body</p>'));
  });
});
