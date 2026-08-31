export const DEFAULT_MAX_INPUT_CHARACTERS = 4096;

export function isValidMaxInputCharacters(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function exceedsInputCharacterLimit(text: string, limit: number): boolean {
  return text.length > limit;
}

export function getInputCharacterLimitMessage(limit: number): string {
  return `Input exceeds the character limit. Please reduce the input to ${limit} characters or fewer.`;
}
