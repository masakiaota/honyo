import { expect, it } from 'vitest';
import { localDirection, validateLocalInput, validateLocalOutput } from './model.ts';
it.each([
  ['Please save your work.', 'English', 'Japanese'],
  ['保存してください。', 'Japanese', 'English'],
  ['設定', 'Japanese', 'English'],
  ['Run `設定` now.', 'English', 'Japanese'],
])('detects prose direction for %s', (text, sourceLanguage, targetLanguage) => {
  expect(localDirection(text, 'Japanese', 'English')).toEqual({ sourceLanguage, targetLanguage });
  expect(localDirection(text, 'English', 'Japanese')).toEqual({ sourceLanguage, targetLanguage });
});
it('rejects unsupported language settings', () => {
  expect(() => localDirection('Hello', 'French', 'Japanese')).toThrow();
  expect(() => localDirection('Hello', 'English', 'English')).toThrow();
});
it('limits input by Unicode characters without silently truncating', () => {
  expect(() => validateLocalInput('a'.repeat(2000))).not.toThrow();
  expect(() => validateLocalInput('a'.repeat(2001))).toThrow();
  expect(() => validateLocalInput('   ')).toThrow();
});
it('rejects empty, looping and untranslated English output', () => {
  expect(() => validateLocalOutput('', 'Japanese')).toThrow();
  expect(() => validateLocalOutput('This is a repeated phrase.'.repeat(5), 'English')).toThrow();
  expect(() => validateLocalOutput('これは日本語です。', 'English')).toThrow();
  expect(() => validateLocalOutput('Not everyone agrees.', 'English')).not.toThrow();
});

it('does not accept damaged code or URLs as successful translations', () => {
  expect(() => validateLocalOutput('実行する', 'Japanese', 'Run `npm install`')).toThrow();
  expect(() => validateLocalOutput('サイト', 'Japanese', 'Visit https://example.com')).toThrow();
  expect(() => validateLocalOutput('Run `日本語`', 'English', '`日本語`を実行する')).not.toThrow();
});
