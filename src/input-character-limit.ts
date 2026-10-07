import { isLocalModel, LOCAL_MAX_CHARACTERS } from './local/model.ts';

export const DEFAULT_MAX_INPUT_CHARACTERS = 4096;

export function isValidMaxInputCharacters(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function getEffectiveMaxInputCharacters(configMax: number, modelId?: string): number {
  if (modelId && isLocalModel(modelId)) return Math.min(configMax, LOCAL_MAX_CHARACTERS);
  return configMax;
}

export function exceedsInputCharacterLimit(text: string, limit: number): boolean {
  return [...text].length > limit;
}

export function getInputCharacterLimitMessage(limit: number): string {
  return `Input exceeds the character limit. Please reduce the input to ${limit} characters or fewer.`;
}
