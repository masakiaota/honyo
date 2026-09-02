export interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
}

export type DisplayMode = 'notification' | 'popup';

export interface CustomModel {
  model: string;
  provider: 'anthropic' | 'openai' | 'google';
}

export const OPENAI_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

export interface Config {
  targetLanguage: string;
  secondaryLanguage: string;
  isPaused: boolean;
  aiModel: string;
  autoCloseOnBlur?: boolean;
  customPrompt: string;
  maxInputCharacters: number;
  displayMode: DisplayMode;
  customModel?: CustomModel;
  openaiReasoningEfforts?: Partial<Record<string, OpenAIReasoningEffort>>;
  openaiFastModels?: string[];
  codexReasoningEfforts?: Partial<Record<string, string>>;
  codexFastModels?: string[];
  customLanguages?: string[];
  skippedUpdateVersion?: string;
  enableStreaming?: boolean;
  openAtLogin?: boolean;
  popupFontSize?: number;
  popupSize?: { width: number; height: number };
}

export interface SavedConfig extends Config {
  fallbackLanguage?: string; // For migration
}
