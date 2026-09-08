export const LOCAL_MODEL_ID = 'local-hy-mt-1.8b';
export const LOCAL_MODEL = {
  name: 'Hy-MT2 1.8B · Offline',
  file: 'Hy-MT2-1.8B-Q4_K_M.gguf',
  bytes: 1133080448,
  sha256: 'dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699',
  url: 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/a0c709d9fac510f2c807aa3af52872340dc37a4a/Hy-MT2-1.8B-Q4_K_M.gguf',
};
export const LOCAL_MAX_CHARACTERS = 2000;

export interface LocalResult {
  translation: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export function localDirection(
  text: string,
  primary: string,
  secondary: string,
): Omit<LocalResult, 'translation'> {
  if (
    !['English', 'Japanese'].includes(primary) ||
    !['English', 'Japanese'].includes(secondary) ||
    primary === secondary
  ) {
    throw new Error(
      'Offline translation supports English ↔ Japanese. Please change your language settings.',
    );
  }
  // Kana/Kanji identify Japanese, including short labels containing only Kanji.
  // Ignore code and URLs so identifiers do not affect prose language detection.
  const prose = text.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g, '');
  const sourceLanguage = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(prose)
    ? 'Japanese'
    : 'English';
  return { sourceLanguage, targetLanguage: sourceLanguage === 'Japanese' ? 'English' : 'Japanese' };
}

export function validateLocalInput(text: string): void {
  if (!text.trim()) throw new Error('Enter text to translate.');
  if ([...text].length > LOCAL_MAX_CHARACTERS)
    throw new Error('Offline translation supports up to 2,000 characters. Please split the text.');
}

export function validateLocalOutput(text: string, target: string, source = ''): void {
  const protectedParts = (source.match(/```[\s\S]*?```|`[^`]+`|https?:\/\/[^\s)<>]+/g) ?? []).map(
    part => (part.startsWith('http') ? part.replace(/[.,!?;:。！？、]+$/, '') : part),
  );
  if (protectedParts.some(part => !text.includes(part))) {
    throw new Error(
      'The translation did not preserve code or URLs. Try translating the prose separately.',
    );
  }
  if (!text.trim() || /(.{12,})\1{3,}/su.test(text))
    throw new Error('Could not generate a valid translation. Try a shorter passage.');
  if (
    target === 'Japanese' &&
    (source.match(/[A-Za-z]+/g)?.length ?? 0) >= 3 &&
    !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)
  ) {
    throw new Error('The output was not translated into Japanese. Try a shorter passage.');
  }
  const prose = protectedParts.reduce((value, part) => value.replaceAll(part, ''), text);
  if (target === 'English' && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(prose))
    throw new Error('The output was not translated into English. Try a shorter passage.');
}
