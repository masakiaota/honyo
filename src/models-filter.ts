import type { AIModelInfo } from './models.ts';

export const MAX_MODELS_PER_PROVIDER = 10;

// Trailing dated-snapshot suffix, e.g. "-2024-11-20" or "-20250929".
const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8})$/;

/** Strip a trailing dated-snapshot suffix from a model id, if present. */
export function stripDateSuffix(id: string): string {
  return id.replace(DATE_SUFFIX, '');
}

/**
 * Reduce a per-provider model list (assumed already sorted newest-first):
 * 1. Drop dated-snapshot variants whose non-dated base id is also present.
 * 2. Cap to the top MAX_MODELS_PER_PROVIDER entries.
 * Pure — no I/O, no electron — so it is safe to unit test directly.
 */
export function limitModels(models: AIModelInfo[]): AIModelInfo[] {
  const allIds = new Set(models.map(m => m.model));
  const deduped = models.filter(m => {
    const base = stripDateSuffix(m.model);
    // Drop only when this id is a dated variant AND its base exists in the list.
    if (base !== m.model && allIds.has(base)) return false;
    return true;
  });
  return deduped.slice(0, MAX_MODELS_PER_PROVIDER);
}
