import { describe, it, expect } from 'vitest';
import { limitModels, stripDateSuffix, MAX_MODELS_PER_PROVIDER } from './models-filter.ts';
import type { AIModelInfo } from './models.ts';

function m(model: string): AIModelInfo {
  return { provider: 'openai', name: model, model };
}

describe('stripDateSuffix', () => {
  it('strips YYYY-MM-DD suffix', () => {
    expect(stripDateSuffix('gpt-4o-2024-11-20')).toBe('gpt-4o');
  });

  it('strips YYYYMMDD suffix', () => {
    expect(stripDateSuffix('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
  });

  it('leaves ids without a date suffix unchanged', () => {
    expect(stripDateSuffix('gemini-3.6-flash')).toBe('gemini-3.6-flash');
  });
});

describe('limitModels', () => {
  it('drops a dated variant when its base id is present', () => {
    const result = limitModels([m('gpt-4o'), m('gpt-4o-2024-11-20'), m('gpt-4o-2024-08-06')]);
    expect(result.map(x => x.model)).toEqual(['gpt-4o']);
  });

  it('keeps a dated id when its base is not present', () => {
    const result = limitModels([m('o4-mini-deep-research-2024-06-26')]);
    expect(result.map(x => x.model)).toEqual(['o4-mini-deep-research-2024-06-26']);
  });

  it('keeps both when neither is a dated variant of the other', () => {
    const result = limitModels([m('claude-sonnet-5'), m('claude-fable-5')]);
    expect(result.map(x => x.model)).toEqual(['claude-sonnet-5', 'claude-fable-5']);
  });

  it('caps the list to MAX_MODELS_PER_PROVIDER, preserving order', () => {
    const many = Array.from({ length: MAX_MODELS_PER_PROVIDER + 5 }, (_, i) => m(`model-${i}`));
    const result = limitModels(many);
    expect(result).toHaveLength(MAX_MODELS_PER_PROVIDER);
    expect(result[0]?.model).toBe('model-0');
    expect(result[MAX_MODELS_PER_PROVIDER - 1]?.model).toBe(`model-${MAX_MODELS_PER_PROVIDER - 1}`);
  });

  it('applies dedupe before the cap', () => {
    const list = [
      m('a'),
      m('a-2025-01-01'),
      ...Array.from({ length: MAX_MODELS_PER_PROVIDER }, (_, i) => m(`b-${i}`)),
    ];
    const result = limitModels(list);
    expect(result).toHaveLength(MAX_MODELS_PER_PROVIDER);
    expect(result.map(x => x.model)).not.toContain('a-2025-01-01');
    expect(result[0]?.model).toBe('a');
  });
});
