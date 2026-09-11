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
  aiModel: 'codex:a',
  targetLanguage: 'French',
  secondaryLanguage: 'English',
  displayMode: 'notification',
  isPaused: false,
  customPrompt: 'Keep names',
  maxInputCharacters: 2000,
  codexReasoningEfforts: { a: 'low' },
  codexFastModels: [],
};
const catalog: Record<string, AIModelInfo> = {
  'codex:a': {
    provider: 'codex',
    name: 'A',
    model: 'a',
    reasoningEffortOptions: [{ reasoningEffort: 'low' }],
  },
  'codex:b': {
    provider: 'codex',
    name: 'B',
    model: 'b',
    reasoningEffortOptions: [{ reasoningEffort: 'high' }, { reasoningEffort: 'ultra' }],
    serviceTiers: [{ id: 'priority', name: 'Fast' }],
  },
  'openai:a': { provider: 'openai', name: 'API A', model: 'a' },
  local: { provider: 'local', name: 'Offline', model: 'local' },
};
const draft: ModelDraft = {
  provider: 'codex',
  modelId: 'codex:b',
  customModel: '',
  effort: 'ultra',
  fast: true,
};
it('saves the model and its options together, preserving language/display and previous model preferences', () => {
  const next = applyModelDraft(config, draft, catalog);
  expect(next.aiModel).toBe('codex:b');
  expect(next.codexReasoningEfforts).toEqual({ a: 'low', b: 'ultra' });
  expect(next.codexFastModels).toEqual(['b']);
  expect(next.targetLanguage).toBe('French');
  expect(next.displayMode).toBe('notification');
  expect(config.aiModel).toBe('codex:a');
  expect(next.modelHistory?.codex).toEqual({ modelId: 'codex:b', customModel: '' });
  const a = resolveDraft({ ...draft, modelId: 'codex:a' }, catalog);
  expect(draftForModel(next, 'codex:a', a)).toMatchObject({ effort: 'low', fast: false });
});
it.each([
  { ...draft, provider: 'openai' as const },
  { ...draft, modelId: 'removed' },
  { ...draft, modelId: 'codex:a' },
  { ...draft, effort: 'low' },
  { ...draft, provider: 'local' as const, modelId: 'local' },
])('rejects mismatched, stale or unsupported selections before changing settings: %j', value => {
  expect(() => applyModelDraft(config, value, catalog)).toThrow();
  expect(config.aiModel).toBe('codex:a');
});
it('does not inherit options across providers even when model names match', () => {
  const model = resolveDraft({ ...draft, provider: 'openai', modelId: 'openai:a' }, catalog);
  expect(draftForModel(config, 'openai:a', model)).toMatchObject({ effort: null, fast: false });
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
  expect(() => resolveDraft({ ...manual, provider: 'codex' }, catalog)).toThrow();
  expect(() => applyModelDraft(config, { ...manual, effort: 'high' }, catalog)).toThrow();
});
it('drops saved options that disappear from the refreshed catalog', () => {
  const m = resolveDraft(draft, catalog);
  expect(
    draftForModel({ ...config, codexReasoningEfforts: { b: 'max' } }, 'codex:b', m).effort,
  ).toBeNull();
});
