import { expect, it } from 'vitest';
import {
  applyModelDraft,
  draftForModel,
  resolveDraft,
  modelCapabilities,
} from './model-selection.ts';
import type { ModelDraft } from './model-selection.ts';
import type { AIModelInfo } from './models.ts';
import type { Config } from './config/types.ts';
const config: Config = {
  aiModel: 'gpt-5.6-sol',
  targetLanguage: 'French',
  secondaryLanguage: 'English',
  displayMode: 'notification',
  isPaused: false,
  customPrompt: 'Keep names',
  maxInputCharacters: 2000,
  openaiReasoningEfforts: { 'gpt-5.6-sol': 'low' },
  openaiFastModels: [],
};
const catalog: Record<string, AIModelInfo> = {
  'gpt-5.6-sol': {
    provider: 'openai',
    name: 'A',
    model: 'gpt-5.6-sol',
  },
  'gpt-5.6-terra': {
    provider: 'openai',
    name: 'B',
    model: 'gpt-5.6-terra',
  },
  'google:a': { provider: 'google', name: 'Other provider', model: 'gpt-5.6-sol' },
  'gpt-4o': { provider: 'openai', name: 'GPT-4o', model: 'gpt-4o' },
  local: { provider: 'local', name: 'Offline', model: 'local' },
};
const draft: ModelDraft = {
  provider: 'openai',
  modelId: 'gpt-5.6-terra',
  customModel: '',
  effort: 'high',
  fast: true,
};
it('saves the model and its options together, preserving language/display and previous model preferences', () => {
  const next = applyModelDraft(config, draft, catalog);
  expect(next.aiModel).toBe('gpt-5.6-terra');
  expect(next.openaiReasoningEfforts).toEqual({ 'gpt-5.6-sol': 'low', 'gpt-5.6-terra': 'high' });
  expect(next.openaiFastModels).toEqual(['gpt-5.6-terra']);
  expect(next.targetLanguage).toBe('French');
  expect(next.displayMode).toBe('notification');
  expect(config.aiModel).toBe('gpt-5.6-sol');
  expect(next.modelHistory?.openai).toEqual({ modelId: 'gpt-5.6-terra', customModel: '' });
  const a = resolveDraft({ ...draft, modelId: 'gpt-5.6-sol' }, catalog);
  expect(draftForModel(next, 'gpt-5.6-sol', a)).toMatchObject({ effort: 'low', fast: false });
});
it.each([
  { ...draft, provider: 'google' as const },
  { ...draft, modelId: 'removed' },
  { ...draft, modelId: 'gpt-4o' },
  { ...draft, effort: 'ultra' },
  { ...draft, provider: 'local' as const, modelId: 'local' },
])('rejects mismatched, stale or unsupported selections before changing settings: %j', value => {
  expect(() => applyModelDraft(config, value, catalog)).toThrow();
  expect(config.aiModel).toBe('gpt-5.6-sol');
});
it('does not inherit options across providers even when model names match', () => {
  const model = resolveDraft({ ...draft, provider: 'google', modelId: 'google:a' }, catalog);
  expect(draftForModel(config, 'google:a', model)).toMatchObject({ effort: null, fast: false });
});
it('manual models use a selected API provider and unknown capabilities stay off', () => {
  const manual: ModelDraft = {
    provider: 'openai',
    modelId: 'custom-model',
    customModel: 'gpt-5.6-unlisted',
    effort: null,
    fast: false,
  };
  const model = resolveDraft(manual, catalog);
  expect(modelCapabilities(model)).toEqual({ efforts: [], fast: undefined });
  expect(applyModelDraft(config, manual, catalog).customModel).toEqual({
    provider: 'openai',
    model: 'gpt-5.6-unlisted',
  });
  expect(() => resolveDraft({ ...manual, provider: 'local' }, catalog)).toThrow();
  expect(() => applyModelDraft(config, { ...manual, effort: 'high' }, catalog)).toThrow();
});
it('drops a saved effort when the selected model does not support it', () => {
  const m = { ...resolveDraft(draft, catalog), model: 'gpt-6-astra' };
  expect(
    draftForModel(
      { ...config, openaiReasoningEfforts: { 'gpt-6-astra': 'none' } },
      'gpt-5.6-terra',
      m,
    ).effort,
  ).toBeNull();
});
