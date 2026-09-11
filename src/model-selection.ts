import type { AIModelInfo, AIProvider } from './models.ts';
import { CUSTOM_MODEL_ID } from './models.ts';
import type { Config, CustomModel, OpenAIReasoningEffort } from './config/types.ts';
import { getReasoningEffortOptions, getFastModeServiceTier } from './reasoning-effort.ts';

export interface ModelDraft {
  provider: AIProvider;
  modelId: string;
  customModel: string;
  effort: string | null;
  fast: boolean;
}
export const PROVIDERS: Array<{ id: AIProvider; name: string }> = [
  { id: 'local', name: 'Local / On-device' },
  { id: 'codex', name: 'ChatGPT Subscription' },
  { id: 'openai', name: 'OpenAI API' },
  { id: 'anthropic', name: 'Anthropic API' },
  { id: 'google', name: 'Google API' },
];
export function resolveDraft(draft: ModelDraft, catalog: Record<string, AIModelInfo>): AIModelInfo {
  if (
    !draft ||
    !PROVIDERS.some(p => p.id === draft.provider) ||
    typeof draft.modelId !== 'string' ||
    typeof draft.customModel !== 'string' ||
    typeof draft.fast !== 'boolean' ||
    !(draft.effort === null || typeof draft.effort === 'string')
  )
    throw new Error('Invalid model settings.');
  if (draft.modelId === CUSTOM_MODEL_ID) {
    if (
      !['openai', 'anthropic', 'google'].includes(draft.provider) ||
      !draft.customModel.trim() ||
      draft.customModel.length > 200
    )
      throw new Error('Enter a model ID for the selected API provider.');
    const known = Object.values(catalog).find(
      m => m.provider === draft.provider && m.model === draft.customModel.trim(),
    );
    if (known) return known;
    return {
      optionsKnown: false,
      provider: draft.provider,
      model: draft.customModel.trim(),
      name: draft.customModel.trim(),
    };
  }
  const model = Object.hasOwn(catalog, draft.modelId) ? catalog[draft.modelId] : undefined;
  if (!model || model.provider !== draft.provider)
    throw new Error('This model is no longer available. Please select a model again.');
  return model;
}
export function modelCapabilities(
  model: AIModelInfo,
  _custom = false,
): {
  efforts: ReturnType<typeof getReasoningEffortOptions>;
  fast: ReturnType<typeof getFastModeServiceTier>;
} {
  return {
    efforts: getReasoningEffortOptions(model),
    fast: getFastModeServiceTier(model),
  };
}
// Keep capability data in the provider adapter; the renderer never infers it from a model name.
export function draftForModel(config: Config, id: string, model: AIModelInfo): ModelDraft {
  const caps = modelCapabilities(model, id === CUSTOM_MODEL_ID);
  const saved =
    model.provider === 'codex'
      ? config.codexReasoningEfforts?.[model.model]
      : model.provider === 'openai'
        ? config.openaiReasoningEfforts?.[model.model]
        : undefined;
  const fast =
    model.provider === 'codex'
      ? config.codexFastModels
      : model.provider === 'openai'
        ? config.openaiFastModels
        : [];
  return {
    provider: model.provider,
    modelId: id,
    customModel: id === CUSTOM_MODEL_ID ? model.model : '',
    effort: caps.efforts.some(x => x.reasoningEffort === saved) ? (saved ?? null) : null,
    fast: !!caps.fast && !!fast?.includes(model.model),
  };
}
export function applyModelDraft(
  config: Config,
  draft: ModelDraft,
  catalog: Record<string, AIModelInfo>,
): Config {
  const model = resolveDraft(draft, catalog);
  const caps = modelCapabilities(model, draft.modelId === CUSTOM_MODEL_ID);
  if (draft.effort !== null && !caps.efforts.some(x => x.reasoningEffort === draft.effort))
    throw new Error('This reasoning effort is not supported by the selected model.');
  if (draft.fast && !caps.fast) throw new Error('Fast mode is not available for this model.');
  const next = {
    ...config,
    aiModel: draft.modelId,
    modelHistory: {
      ...config.modelHistory,
      [draft.provider]: { modelId: draft.modelId, customModel: draft.customModel },
    },
  };
  if (draft.modelId === CUSTOM_MODEL_ID)
    next.customModel = { provider: draft.provider as CustomModel['provider'], model: model.model };
  if (model.provider === 'codex') {
    next.codexReasoningEfforts = { ...config.codexReasoningEfforts };
    if (draft.effort === null) delete next.codexReasoningEfforts[model.model];
    else next.codexReasoningEfforts[model.model] = draft.effort;
    next.codexFastModels = [
      ...(config.codexFastModels ?? []).filter(x => x !== model.model),
      ...(draft.fast ? [model.model] : []),
    ];
  } else if (model.provider === 'openai') {
    next.openaiReasoningEfforts = { ...config.openaiReasoningEfforts };
    if (draft.effort === null) delete next.openaiReasoningEfforts[model.model];
    else next.openaiReasoningEfforts[model.model] = draft.effort as OpenAIReasoningEffort;
    next.openaiFastModels = [
      ...(config.openaiFastModels ?? []).filter(x => x !== model.model),
      ...(draft.fast ? [model.model] : []),
    ];
  }
  return next;
}
