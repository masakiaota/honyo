import {
  CUSTOM_MODEL_ID,
  type AIModelInfo,
  type ModelServiceTier,
  type ReasoningEffortOption,
} from './models.ts';
import { getModelInfo, getAvailableModels } from './models-remote.ts';
import {
  OPENAI_REASONING_EFFORTS,
  type Config,
  type OpenAIReasoningEffort,
} from './config/types.ts';

export function getSelectedModelInfo(config: Config): AIModelInfo | undefined {
  if (config.aiModel === CUSTOM_MODEL_ID) {
    if (!config.customModel?.model || !config.customModel.provider) return undefined;
    return (
      Object.values(getAvailableModels()).find(
        model =>
          model.provider === config.customModel?.provider &&
          model.model === config.customModel.model,
      ) ?? {
        optionsKnown: false,
        name: config.customModel.model,
        model: config.customModel.model,
        provider: config.customModel.provider,
      }
    );
  }
  return getModelInfo(config.aiModel);
}

/** Exact documented families, with optional dated snapshots; unknown models use their own defaults. */
export function getReasoningEffortOptions(model: AIModelInfo | undefined): ReasoningEffortOption[] {
  if (!model || !['openai', 'chatgpt'].includes(model.provider)) return [];
  const id = model.model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (
    ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-sol', 'gpt-6-luna'].includes(
      id,
    )
  )
    return OPENAI_REASONING_EFFORTS.map(reasoningEffort => ({ reasoningEffort }));
  if (['gpt-6-astra', 'gpt-6.1-sol'].includes(id))
    return OPENAI_REASONING_EFFORTS.filter(effort => effort !== 'none').map(reasoningEffort => ({
      reasoningEffort,
    }));
  return [];
}
export function supportsOpenAIReasoningEffort(model: AIModelInfo | undefined): boolean {
  return getReasoningEffortOptions(model).length > 0;
}
export function supportsOpenAIFastMode(model: AIModelInfo | undefined): boolean {
  return model?.provider === 'openai' && getReasoningEffortOptions(model).length > 0;
}
export function getFastModeServiceTier(
  model: AIModelInfo | undefined,
): ModelServiceTier | undefined {
  return supportsOpenAIFastMode(model) ? { id: 'priority', name: 'Fast' } : undefined;
}
export function getReasoningEffort(
  config: Config,
  model = getSelectedModelInfo(config),
): OpenAIReasoningEffort | undefined {
  if (!model) return undefined;
  const options = getReasoningEffortOptions(model);
  const saved =
    model.provider === 'chatgpt'
      ? config.chatgptReasoningEfforts?.[model.model]
      : model.provider === 'openai'
        ? config.openaiReasoningEfforts?.[model.model]
        : undefined;
  if (saved === null) return undefined; // Explicit model default, distinct from a new selection.
  if (saved !== undefined)
    return options.some(option => option.reasoningEffort === saved) ? saved : undefined;
  return options.some(option => option.reasoningEffort === 'none') ? 'none' : undefined;
}
export function getOpenAIRequestOptions(
  config: Config,
  model = getSelectedModelInfo(config),
): {
  effort?: OpenAIReasoningEffort;
  serviceTier?: 'priority';
} {
  const effort = getReasoningEffort(config, model);
  return {
    ...(effort ? { effort } : {}),
    ...(model && supportsOpenAIFastMode(model) && config.openaiFastModels?.includes(model.model)
      ? { serviceTier: 'priority' as const }
      : {}),
  };
}
