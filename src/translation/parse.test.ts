import { describe, it, expect } from 'vitest';
import { parseTranslationOutput, isHeaderResolvable } from './parse.ts';

describe('parseTranslationOutput', () => {
  it('parses an ASCII-arrow header and returns the body', () => {
    const r = parseTranslationOutput('[English -> Japanese]\nこんにちは');
    expect(r.sourceLanguage).toBe('English');
    expect(r.targetLanguage).toBe('Japanese');
    expect(r.translation).toBe('こんにちは');
  });

  it('parses a Unicode-arrow header', () => {
    const r = parseTranslationOutput('[Japanese → English]\nHello');
    expect(r.sourceLanguage).toBe('Japanese');
    expect(r.targetLanguage).toBe('English');
    expect(r.translation).toBe('Hello');
  });

  it('keeps a multi-line translation body intact', () => {
    const r = parseTranslationOutput('[English -> French]\nline one\nline two');
    expect(r.translation).toBe('line one\nline two');
    expect(r.targetLanguage).toBe('French');
  });

  it('drops extra blank lines the model adds after the header', () => {
    const r = parseTranslationOutput('[English -> German]\n\nHallo');
    expect(r.translation).toBe('Hallo');
  });

  it('tolerates whitespace around the header and names', () => {
    const r = parseTranslationOutput('[  English  ->  Japanese  ]\nやあ');
    expect(r.sourceLanguage).toBe('English');
    expect(r.targetLanguage).toBe('Japanese');
    expect(r.translation).toBe('やあ');
  });

  it('treats the whole output as the translation when there is no header', () => {
    const r = parseTranslationOutput('Just a translation with no header');
    expect(r.translation).toBe('Just a translation with no header');
    expect(r.sourceLanguage).toBeUndefined();
    expect(r.targetLanguage).toBeUndefined();
  });

  it('does not lose text when the first line only looks partly like a header', () => {
    const r = parseTranslationOutput('[not a real header line\nmore text');
    expect(r.translation).toBe('[not a real header line\nmore text');
    expect(r.sourceLanguage).toBeUndefined();
  });

  it('does not treat a header with trailing content on the same line as a header', () => {
    const r = parseTranslationOutput('[English -> Japanese] こんにちは');
    expect(r.sourceLanguage).toBeUndefined();
    expect(r.translation).toBe('[English -> Japanese] こんにちは');
  });

  it('parses a header preceded by stray leading whitespace/newlines', () => {
    const r = parseTranslationOutput('\n\n[English -> Japanese]\nこんにちは');
    expect(r.sourceLanguage).toBe('English');
    expect(r.targetLanguage).toBe('Japanese');
    expect(r.translation).toBe('こんにちは');
  });
});

describe('isHeaderResolvable', () => {
  it('is false for an empty buffer', () => {
    expect(isHeaderResolvable('')).toBe(false);
  });

  it('is false while a header-looking prefix is still buffering', () => {
    expect(isHeaderResolvable('[Engl')).toBe(false);
  });

  it('is true as soon as a newline arrives', () => {
    expect(isHeaderResolvable('[English -> Japanese]\n')).toBe(true);
  });

  it('is true immediately when the buffer does not start with [', () => {
    expect(isHeaderResolvable('Hello')).toBe(true);
  });

  it('is true once a header-looking buffer exceeds the char limit', () => {
    expect(isHeaderResolvable('[' + 'x'.repeat(200), 100)).toBe(true);
  });

  it('keeps buffering while only leading whitespace has arrived', () => {
    expect(isHeaderResolvable('\n\n')).toBe(false);
    expect(isHeaderResolvable('\n[Engl')).toBe(false);
  });
});
