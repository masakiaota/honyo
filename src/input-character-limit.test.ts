import { describe, expect, it } from 'vitest';
import {
  exceedsInputCharacterLimit,
  getEffectiveMaxInputCharacters,
  getInputCharacterLimitMessage,
  isValidMaxInputCharacters,
} from './input-character-limit.ts';
import { LOCAL_MAX_CHARACTERS } from './local/model.ts';

describe('isValidMaxInputCharacters', () => {
  it.each([1, 4096, Number.MAX_SAFE_INTEGER])('accepts %s', value => {
    expect(isValidMaxInputCharacters(value)).toBe(true);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %s',
    value => {
      expect(isValidMaxInputCharacters(value)).toBe(false);
    },
  );
});

describe('exceedsInputCharacterLimit', () => {
  it('allows input exactly at the limit', () => {
    expect(exceedsInputCharacterLimit('abcd', 4)).toBe(false);
  });

  it('rejects input longer than the limit', () => {
    expect(exceedsInputCharacterLimit('abcde', 4)).toBe(true);
  });

  it('counts Unicode characters instead of UTF-16 code units', () => {
    expect(exceedsInputCharacterLimit('😀', 1)).toBe(false);
    expect(exceedsInputCharacterLimit('😀😀', 1)).toBe(true);
  });
});

describe('getEffectiveMaxInputCharacters', () => {
  it('returns the configured limit for cloud models', () => {
    expect(getEffectiveMaxInputCharacters(4096, 'openai:gpt-5')).toBe(4096);
    expect(getEffectiveMaxInputCharacters(10000, 'openai:gpt-5')).toBe(10000);
  });

  it('caps offline models at the local hard limit', () => {
    expect(getEffectiveMaxInputCharacters(4096, 'local-hy-mt-1.8b')).toBe(LOCAL_MAX_CHARACTERS);
    expect(getEffectiveMaxInputCharacters(10000, 'local-hy-mt2-7b-q4')).toBe(LOCAL_MAX_CHARACTERS);
  });

  it('respects a smaller configured limit even for offline models', () => {
    expect(getEffectiveMaxInputCharacters(500, 'local-hy-mt-1.8b')).toBe(500);
  });
});

describe('getInputCharacterLimitMessage', () => {
  it('includes the configured limit', () => {
    expect(getInputCharacterLimitMessage(4096)).toBe(
      'Input exceeds the character limit. Please reduce the input to 4096 characters or fewer.',
    );
  });
});
