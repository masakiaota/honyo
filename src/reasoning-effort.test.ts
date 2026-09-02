import { describe, expect, it } from 'vitest';
import {
  getCodexTurnOptions,
  getOpenAIReasoningEffort,
  getOpenAIProviderOptions,
  getReasoningEffortOptions,
  supportsOpenAIFastMode,
  supportsOpenAIReasoningEffort,
} from './reasoning-effort.ts';
import type { Config } from './config/types.ts';
import { setCodexModels } from './models-remote.ts';

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

describe('ChatGPT/Codex model settings', () => {
  it('uses the account catalog and passes the selected effort and Fast tier to Codex', () => {
    setCodexModels({
      'codex:gpt-5.6-sol': {
        provider: 'codex',
        name: 'GPT-5.6 Sol (ChatGPT)',
        model: 'gpt-5.6-sol',
        reasoningEffortOptions: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }],
        serviceTiers: [{ id: 'priority', name: 'Fast' }],
      },
    });
    const config: Config = {
      ...baseConfig,
      aiModel: 'codex:gpt-5.6-sol',
      codexReasoningEfforts: { 'gpt-5.6-sol': 'ultra' },
      codexFastModels: ['gpt-5.6-sol'],
      openaiReasoningEfforts: { 'gpt-5.6-sol': 'low' },
      openaiFastModels: [],
    };

    expect(
      getReasoningEffortOptions({
        provider: 'codex',
        name: 'GPT-5.6 Sol (ChatGPT)',
        model: 'gpt-5.6-sol',
        reasoningEffortOptions: [{ reasoningEffort: 'ultra' }],
      }),
    ).toEqual([{ reasoningEffort: 'ultra' }]);
    expect(getCodexTurnOptions(config)).toEqual({
      effort: 'ultra',
      serviceTier: 'priority',
    });
  });
});
