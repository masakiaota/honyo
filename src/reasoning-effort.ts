import {
  CUSTOM_MODEL_ID,
  type AIModelInfo,
  type ModelServiceTier,
  type ReasoningEffortOption,
} from './models.ts';
import { getModelInfo } from './models-remote.ts';
import {
  OPENAI_REASONING_EFFORTS,
  type Config,
  type OpenAIReasoningEffort,
} from './config/types.ts';

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

export function getReasoningEffortOptions(
  modelInfo: AIModelInfo | undefined,
): ReasoningEffortOption[] {
  if (modelInfo?.provider === 'codex') return modelInfo.reasoningEffortOptions ?? [];
  if (!supportsOpenAIReasoningEffort(modelInfo)) return [];
  return OPENAI_REASONING_EFFORTS.map(reasoningEffort => ({ reasoningEffort }));
}

export function getFastModeServiceTier(
  modelInfo: AIModelInfo | undefined,
): ModelServiceTier | undefined {
  if (modelInfo?.provider === 'codex') {
    return modelInfo.serviceTiers?.find(tier => tier.name.toLowerCase() === 'fast');
  }
  if (!supportsOpenAIFastMode(modelInfo)) return undefined;
  return { id: 'priority', name: 'Fast' };
}

export function getOpenAIReasoningEffort(config: Config): OpenAIReasoningEffort | undefined {
  const modelInfo = getSelectedModelInfo(config);
  if (!modelInfo || !supportsOpenAIReasoningEffort(modelInfo)) return undefined;
  return config.openaiReasoningEfforts?.[modelInfo.model];
}

export function getSelectedReasoningEffort(config: Config): string | undefined {
  const modelInfo = getSelectedModelInfo(config);
  if (modelInfo?.provider === 'codex') {
    const effort = config.codexReasoningEfforts?.[modelInfo.model];
    return getReasoningEffortOptions(modelInfo).some(option => option.reasoningEffort === effort)
      ? effort
      : undefined;
  }
  return getOpenAIReasoningEffort(config);
}

export function isFastModeEnabled(config: Config): boolean {
  const modelInfo = getSelectedModelInfo(config);
  if (!getFastModeServiceTier(modelInfo) || !modelInfo) return false;
  return modelInfo.provider === 'codex'
    ? config.codexFastModels?.includes(modelInfo.model) === true
    : config.openaiFastModels?.includes(modelInfo.model) === true;
}

export function getCodexTurnOptions(config: Config):
  | {
      effort?: string;
      serviceTier?: string;
    }
  | undefined {
  const modelInfo = getSelectedModelInfo(config);
  if (modelInfo?.provider !== 'codex') return undefined;

  const effort = getSelectedReasoningEffort(config);
  const fastServiceTier = isFastModeEnabled(config) ? getFastModeServiceTier(modelInfo) : undefined;
  if (!effort && !fastServiceTier) return undefined;
  return {
    ...(effort ? { effort } : {}),
    ...(fastServiceTier ? { serviceTier: fastServiceTier.id } : {}),
  };
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
