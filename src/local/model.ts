import { PLAMO_MODELS } from './plamo-models.ts';

export const LOCAL_MODEL_ID = 'local-plamo-3-0.8b';
export interface LocalModelAsset {
  file: string;
  bytes: number;
  sha256: string;
  url: string;
}
export interface LocalModel {
  name: string;
  file: string;
  bytes: number;
  memory: string;
  sourceUrl: string;
  licenseUrl: string;
  assets: readonly LocalModelAsset[];
}
export const LOCAL_MODELS: Record<string, LocalModel> = PLAMO_MODELS;
export const LOCAL_MODEL = getLocalModel();
export function isLocalModel(id: string): boolean {
  return Object.hasOwn(LOCAL_MODELS, id);
}
export function getLocalModel(id = LOCAL_MODEL_ID): LocalModel {
  const model = LOCAL_MODELS[id];
  if (!isLocalModel(id) || !model) throw new Error('Unknown offline model.');
  return model;
}

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
  // Dominant-language detection: a single mentioned character must not flip
  // a long passage. English needs several Latin letters per word while one
  // kana/kanji carries a morpheme, so the neutral point sits below 0.5.
  // Ignore code and URLs so identifiers do not affect prose language detection.
  const prose = text.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g, '');
  const japaneseChars = (
    prose.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? []
  ).length;
  const englishChars = (prose.match(/[A-Za-z]/g) ?? []).length;
  let sourceLanguage = 'English';
  if (japaneseChars > 0 && englishChars === 0) {
    sourceLanguage = 'Japanese';
  } else if (japaneseChars > 0 && englishChars > 0) {
    sourceLanguage = japaneseChars / (japaneseChars + englishChars) >= 0.3 ? 'Japanese' : 'English';
  }
  return { sourceLanguage, targetLanguage: sourceLanguage === 'Japanese' ? 'English' : 'Japanese' };
}

export function validateLocalInput(text: string): void {
  if (!text.trim()) throw new Error('Enter text to translate.');
}

export function validateLocalOutput(text: string, source = ''): void {
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
}
