import type { AIModelInfo } from '../models.ts';

export const CODEX_MODEL_PREFIX = 'codex:';

export interface CodexModelDescriptor {
  id?: string;
  model?: string;
  displayName?: string;
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
    const key = `${CODEX_MODEL_PREFIX}${model}`;
    models[key] = {
      provider: 'codex',
      model,
      name: `${descriptor.displayName ?? model} (ChatGPT)`,
    };
  }

  return models;
}
