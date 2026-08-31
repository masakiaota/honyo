import { describe, expect, it } from 'vitest';
import {
  exceedsInputCharacterLimit,
  getInputCharacterLimitMessage,
} from './input-character-limit.ts';

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
