export const DEFAULT_MAX_INPUT_CHARACTERS = 4096;

export function isValidMaxInputCharacters(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function exceedsInputCharacterLimit(text: string, limit: number): boolean {
  let count = 0;
  const iterator = text[Symbol.iterator]();
  while (true) {
    if (iterator.next().done) return false;
    count += 1;
    if (count > limit) return true;
  }
}

export function getInputCharacterLimitMessage(limit: number): string {
  return `Input exceeds the character limit. Please reduce the input to ${limit} characters or fewer.`;
}
