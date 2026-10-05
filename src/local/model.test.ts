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
it('rejects empty and looping output', () => {
  expect(() => validateLocalOutput('')).toThrow();
  expect(() => validateLocalOutput('This is a repeated phrase.'.repeat(5))).toThrow();
  expect(() => validateLocalOutput('Not everyone agrees.')).not.toThrow();
});

it('allows UI literals in English output', () => {
  const source =
    'タスクバーの IME の表示がずっと「A」のまま Meltype が Windows の IME を OFF にしているためです。';
  expect(() =>
    validateLocalOutput(
      'The taskbar IME shows "A" because Meltype turns Windows IME OFF. The mode is shown by "あ"/"A".',
      source,
    ),
  ).not.toThrow();
  expect(() =>
    validateLocalOutput('Right-click the tray icon and adjust "自動判定の強さ".', source),
  ).not.toThrow();
});

it('does not accept damaged code or URLs as successful translations', () => {
  expect(() => validateLocalOutput('実行する', 'Run `npm install`')).toThrow();
  expect(() => validateLocalOutput('サイト', 'Visit https://example.com')).toThrow();
  expect(() => validateLocalOutput('Run `日本語`', '`日本語`を実行する')).not.toThrow();
});
