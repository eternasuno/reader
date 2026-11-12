import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ArticleContent,
  ArticleDescription,
} from '../../../src/entity/common/article';
import { decodeContent, decodeDescription, decodeTitle } from '../../support';

const decodeArticleDescription = Schema.decodeSync(ArticleDescription);

const decodeArticleContent = Schema.decodeSync(ArticleContent);

describe('ArticleTitle', () => {
  it('trims the title and replaces an empty title with Untitled', () => {
    expect(decodeTitle('  Hello world  ')).toBe('Hello world');
    expect(decodeTitle('   ')).toBe('Untitled');
    expect(decodeTitle('')).toBe('Untitled');
  });
});

describe('ArticleDescription and ArticleContent', () => {
  it('trims both ends and keeps the inner text', () => {
    expect(decodeArticleDescription('  <p>about</p>  ')).toBe('<p>about</p>');
    expect(decodeArticleContent('  <p>body</p>  ')).toBe('<p>body</p>');
  });
});

describe('OptionFromOptionalNonEmpty', () => {
  it('turns absent and blank text into none', () => {
    expect(Option.isNone(decodeDescription(undefined))).toBe(true);
    expect(Option.isNone(decodeDescription(''))).toBe(true);
    expect(Option.isNone(decodeDescription('   '))).toBe(true);
    expect(Option.isNone(decodeContent(undefined))).toBe(true);
    expect(Option.isNone(decodeContent('  '))).toBe(true);
  });

  it('trims present text and keeps it', () => {
    expect(decodeDescription('  <p>about</p> ')).toEqual(
      Option.some('<p>about</p>')
    );
    expect(decodeContent(' <p>body</p> ')).toEqual(Option.some('<p>body</p>'));
  });
});
