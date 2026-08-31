export const DEFAULT_MAX_INPUT_CHARACTERS = 4096;

export function exceedsInputCharacterLimit(text: string, limit: number): boolean {
  return text.length > limit;
}

export function getInputCharacterLimitMessage(limit: number): string {
  return `Input exceeds the character limit. Please reduce the input to ${limit} characters or fewer.`;
}
