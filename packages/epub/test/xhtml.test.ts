import { describe, expect, it } from 'vitest';
import { escapeXml, xmlCharacters } from '../src/xhtml';

describe('XML characters', () => {
  it('KD-BOOK-5 drops characters XML 1.0 forbids and keeps the rest', () => {
    expect(xmlCharacters('a\u0001b\u000Bc\uFFFEd\uD800e')).toBe('abcde');
    expect(xmlCharacters('tab\there\nline\r中文😀')).toBe(
      'tab\there\nline\r中文😀'
    );
  });

  it('KD-BOOK-3 a title with a control character still escapes to valid XML', () => {
    expect(escapeXml('<a>\u0007&')).toBe('&lt;a&gt;&amp;');
  });
});
