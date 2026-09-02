import type { AIModelInfo, ModelServiceTier, ReasoningEffortOption } from '../models.ts';

export const CODEX_MODEL_PREFIX = 'codex:';

export interface CodexModelDescriptor {
  id?: string;
  model?: string;
  displayName?: string;
  supportedReasoningEfforts?: ReasoningEffortOption[];
  serviceTiers?: ModelServiceTier[];
}

export function isCodexModelKey(value: string): boolean {
  return value.startsWith(CODEX_MODEL_PREFIX) && value.length > CODEX_MODEL_PREFIX.length;
}

export function getCodexModelId(key: string): string | undefined {
  return isCodexModelKey(key) ? key.slice(CODEX_MODEL_PREFIX.length) : undefined;
}

/** Convert the App Server catalog into Honyo's model-menu shape. */
export function toCodexModels(descriptors: CodexModelDescriptor[]): Record<string, AIModelInfo> {
  const models: Record<string, AIModelInfo> = {};

  for (const descriptor of descriptors) {
    const model = descriptor.model ?? descriptor.id;
    if (!model) continue;
    const reasoningEffortOptions = descriptor.supportedReasoningEfforts?.filter(
      option => typeof option.reasoningEffort === 'string' && option.reasoningEffort.length > 0,
    );
    const serviceTiers = descriptor.serviceTiers?.filter(
      tier => typeof tier.id === 'string' && tier.id.length > 0 && typeof tier.name === 'string',
    );
    const key = `${CODEX_MODEL_PREFIX}${model}`;
    models[key] = {
      provider: 'codex',
      model,
      name: `${descriptor.displayName ?? model} (ChatGPT)`,
      ...(reasoningEffortOptions?.length ? { reasoningEffortOptions } : {}),
      ...(serviceTiers?.length ? { serviceTiers } : {}),
    };
  }

  return models;
}
