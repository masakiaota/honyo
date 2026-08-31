import { CUSTOM_MODEL_ID, type AIModelInfo } from './models.ts';
import { getModelInfo } from './models-remote.ts';
import type { Config, OpenAIReasoningEffort } from './config/types.ts';

export function getSelectedModelInfo(config: Config): AIModelInfo | undefined {
  if (config.aiModel === CUSTOM_MODEL_ID) {
    if (!config.customModel?.model || !config.customModel.provider) return undefined;
    return {
      name: config.customModel.model,
      model: config.customModel.model,
      provider: config.customModel.provider,
    };
  }

  return getModelInfo(config.aiModel);
}

export function supportsOpenAIReasoningEffort(modelInfo: AIModelInfo | undefined): boolean {
  if (modelInfo?.provider !== 'openai') return false;
  return /^(gpt-5|o[1-9])(?:[.-]|$)/.test(modelInfo.model);
}

export function supportsOpenAIFastMode(modelInfo: AIModelInfo | undefined): boolean {
  return modelInfo?.provider === 'openai' && /^gpt-5\.6(?:[.-]|$)/.test(modelInfo.model);
}

export function getOpenAIReasoningEffort(config: Config): OpenAIReasoningEffort | undefined {
  const modelInfo = getSelectedModelInfo(config);
  if (!modelInfo || !supportsOpenAIReasoningEffort(modelInfo)) return undefined;
  return config.openaiReasoningEfforts?.[modelInfo.model];
}

export function getOpenAIProviderOptions(config: Config):
  | {
      openai: {
        reasoningEffort?: OpenAIReasoningEffort;
        serviceTier?: 'priority';
      };
    }
  | undefined {
  const modelInfo = getSelectedModelInfo(config);
  const reasoningEffort = getOpenAIReasoningEffort(config);
  const fastMode =
    modelInfo &&
    supportsOpenAIFastMode(modelInfo) &&
    config.openaiFastModels?.includes(modelInfo.model);
  if (!reasoningEffort && !fastMode) return undefined;

  return {
    openai: {
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(fastMode ? { serviceTier: 'priority' as const } : {}),
    },
  };
}
