import { describe, expect, it } from 'vitest';
import {
  getOpenAIReasoningEffort,
  getOpenAIProviderOptions,
  supportsOpenAIFastMode,
  supportsOpenAIReasoningEffort,
} from './reasoning-effort.ts';
import type { Config } from './config/types.ts';

const baseConfig: Config = {
  targetLanguage: 'English',
  secondaryLanguage: 'Japanese',
  isPaused: false,
  aiModel: 'custom-model',
  customPrompt: '',
  maxInputCharacters: 4096,
  displayMode: 'notification',
  customModel: {
    provider: 'openai',
    model: 'gpt-5.6-luna',
  },
};

describe('OpenAI reasoning effort', () => {
  it('uses the effort saved for the selected GPT-5 model', () => {
    const config: Config = {
      ...baseConfig,
      openaiReasoningEfforts: { 'gpt-5.6-luna': 'low' },
    };

    expect(getOpenAIReasoningEffort(config)).toBe('low');
    expect(getOpenAIProviderOptions(config)).toEqual({
      openai: { reasoningEffort: 'low' },
    });
  });

  it('does not apply an effort saved for a different model', () => {
    const config: Config = {
      ...baseConfig,
      openaiReasoningEfforts: { 'gpt-5.6-terra': 'high' },
    };

    expect(getOpenAIReasoningEffort(config)).toBeUndefined();
  });

  it('does not expose reasoning effort for a non-reasoning OpenAI model', () => {
    expect(
      supportsOpenAIReasoningEffort({ provider: 'openai', name: 'GPT-4o', model: 'gpt-4o' }),
    ).toBe(false);
  });

  it('adds the priority service tier for Fast mode on GPT-5.6', () => {
    const config: Config = {
      ...baseConfig,
      openaiFastModels: ['gpt-5.6-luna'],
    };

    expect(
      supportsOpenAIFastMode({ provider: 'openai', name: 'GPT-5.6 Luna', model: 'gpt-5.6-luna' }),
    ).toBe(true);
    expect(getOpenAIProviderOptions(config)).toEqual({
      openai: { serviceTier: 'priority' },
    });
  });
});
