import { describe, expect, it } from 'vitest';
import {
  exceedsInputCharacterLimit,
  getInputCharacterLimitMessage,
  isValidMaxInputCharacters,
} from './input-character-limit.ts';

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
});

describe('getInputCharacterLimitMessage', () => {
  it('includes the configured limit', () => {
    expect(getInputCharacterLimitMessage(4096)).toBe(
      'Input exceeds the character limit. Please reduce the input to 4096 characters or fewer.',
    );
  });
});
