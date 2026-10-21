import { describe, expect, it } from 'vitest';
import {
  getReasoningEffort,
  getOpenAIRequestOptions,
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

    expect(getReasoningEffort(config)).toBe('low');
    expect(getOpenAIRequestOptions(config)).toEqual({
      effort: 'low',
    });
  });

  it('does not apply an effort saved for a different model', () => {
    const config: Config = {
      ...baseConfig,
      openaiReasoningEfforts: { 'gpt-5.6-terra': 'high' },
    };

    expect(getReasoningEffort(config)).toBe('none');
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
    expect(getOpenAIRequestOptions(config)).toEqual({
      effort: 'none',
      serviceTier: 'priority',
    });
  });
});

it('keeps an explicit model default separate from a new none selection', () => {
  expect(
    getReasoningEffort({ ...baseConfig, openaiReasoningEfforts: { 'gpt-5.6-luna': null } }),
  ).toBeUndefined();
  expect(getReasoningEffort(baseConfig)).toBe('none');
});
it('keeps ChatGPT effort preferences separate from API-key preferences', () => {
  const model = { provider: 'chatgpt' as const, model: 'gpt-6-luna', name: 'Luna' };
  expect(
    getReasoningEffort({ ...baseConfig, openaiReasoningEfforts: { 'gpt-6-luna': 'high' } }, model),
  ).toBe('none');
  expect(
    getReasoningEffort({ ...baseConfig, chatgptReasoningEfforts: { 'gpt-6-luna': 'low' } }, model),
  ).toBe('low');
  expect(getReasoningEffort(baseConfig, { ...model, model: 'gpt-6.1-sol' })).toBeUndefined();
});
