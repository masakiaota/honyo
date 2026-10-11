import { getLocalModel, LOCAL_MODELS, LOCAL_MODEL_ID } from './model.ts';
import { LOCAL_MLX_7B_MODEL_ID } from './mlx-model.ts';

export type LocalFamily = 'hy18' | 'hy7';
export const LOCAL_FAMILIES: ReadonlyArray<{ id: LocalFamily; name: string; recommended: string }> =
  [
    { id: 'hy18', name: 'Hy-MT2 1.8B · Lightweight', recommended: LOCAL_MODEL_ID },
    { id: 'hy7', name: 'Hy-MT2 7B · Higher quality', recommended: LOCAL_MLX_7B_MODEL_ID },
  ];

export function localRuntime(id: string): {
  family: LocalFamily;
  backend: string;
  recommended: boolean;
} {
  const model = getLocalModel(id);
  return {
    family: model.template,
    backend:
      model.engine === 'mlx'
        ? `Swift MLX · 4-bit${model.template === 'hy18' ? ' · Experimental, LF-only' : ''}`
        : 'llama.cpp · GGUF Q4_K_M',
    recommended: LOCAL_FAMILIES.find(family => family.id === model.template)?.recommended === id,
  };
}

/** A family change is explicit. Never silently migrate saved IDs or choose an unverified backend. */
export function recommendedLocalModel(family: LocalFamily): string {
  const choice = LOCAL_FAMILIES.find(item => item.id === family);
  if (!choice || !Object.hasOwn(LOCAL_MODELS, choice.recommended))
    throw new Error('Unknown offline model family.');
  return choice.recommended;
}
