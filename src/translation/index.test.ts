import { beforeEach, expect, it, vi } from 'vitest';
import type { Config } from '../config/types.ts';
const mock = vi.hoisted(() => ({ generate: vi.fn(), config: {} as Config }));
vi.mock('../config/index.ts', () => ({ getConfig: (): Config => mock.config }));
vi.mock('../local/index.ts', () => ({ translateLocal: vi.fn() }));
vi.mock('./providers.ts', () => ({ generateModelText: mock.generate }));
import { translateTextDetailed, translateTextStreaming } from './index.ts';
beforeEach(() => {
  vi.clearAllMocks();
  mock.config = {
    aiModel: 'chatgpt:gpt-6-luna',
    targetLanguage: 'Japanese',
    secondaryLanguage: 'English',
    isPaused: false,
    customPrompt: 'Keep names',
    maxInputCharacters: 4096,
    displayMode: 'popup',
  };
});
it('preserves split-header handling, partial output, final trimming and language notification', async () => {
  mock.generate.mockImplementation(
    (
      _config: Config,
      _instructions: string,
      _input: string,
      onText: (text: string) => void,
    ): Promise<string> => {
      for (const raw of [
        '[English',
        '[English -> Japanese]\n',
        '[English -> Japanese]\nこんに',
        '[English -> Japanese]\nこんにちは。 ',
      ])
        onText(raw);
      return Promise.resolve('[English -> Japanese]\nこんにちは。 ');
    },
  );
  const chunks: string[] = [];
  const languages = vi.fn();
  expect(
    await translateTextStreaming(
      'Hello',
      'Japanese',
      'English',
      text => chunks.push(text),
      undefined,
      languages,
    ),
  ).toBe('こんにちは。');
  expect(chunks).toEqual(['', 'こんに', 'こんにちは。 ', 'こんにちは。 ']);
  expect(languages).toHaveBeenCalledExactlyOnceWith('English', 'Japanese');
});
it('keeps output without a valid header unchanged', async () => {
  mock.generate.mockImplementation(
    (
      _config: Config,
      _instructions: string,
      _input: string,
      onText: (text: string) => void,
    ): Promise<string> => {
      onText('こんにちは');
      return Promise.resolve('こんにちは');
    },
  );
  expect(await translateTextStreaming('Hello', 'Japanese', 'English', vi.fn())).toBe('こんにちは');
});
it('never returns partial output as successful after a failed stream', async () => {
  mock.generate.mockImplementation(
    (
      _config: Config,
      _instructions: string,
      _input: string,
      onText: (text: string) => void,
    ): Promise<string> => {
      onText('[English -> Japanese]\n途中');
      return Promise.reject(new Error('stream failed'));
    },
  );
  await expect(translateTextStreaming('Hello', 'Japanese', 'English', vi.fn())).rejects.toThrow(
    'stream failed',
  );
});
it('keeps non-streaming translation and prompt instructions unchanged', async () => {
  mock.generate.mockResolvedValue('[English -> Japanese]\nこんにちは。 ');
  expect(await translateTextDetailed('Hello', 'Japanese', 'English')).toEqual({
    translation: 'こんにちは。',
    sourceLanguage: 'English',
    targetLanguage: 'Japanese',
  });
  expect(mock.generate.mock.calls[0]?.[1]).toContain('Additional instructions:\nKeep names');
});
