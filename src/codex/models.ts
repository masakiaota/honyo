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

/**
 * Desired state of the Codex App Server (the "should this be running at all?"
 * rule). The server is a heavyweight sidecar: a Node launcher plus the native
 * `codex` binary, roughly 130 MB together. It must therefore run only while the
 * user can actually reach Codex:
 *
 * - a Codex model is selected (translations go through the App Server), or
 * - the model settings window is open (sign-in, account status, catalog,
 *   previews).
 *
 * Local, API-key, and custom models must not keep it resident, so their memory
 * stays available to the model they actually use.
 */
export function shouldRunCodexServer(selectedModel: string, settingsOpen: boolean): boolean {
  return settingsOpen || isCodexModelKey(selectedModel);
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
