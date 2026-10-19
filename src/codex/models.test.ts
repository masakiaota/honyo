import { describe, expect, it } from 'vitest';
import { getCodexModelId, isCodexModelKey, shouldRunCodexServer, toCodexModels } from './models.ts';

describe('Codex model catalog', () => {
  it('uses a separate key space so API and ChatGPT models cannot collide', () => {
    const models = toCodexModels([
      { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
      { model: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra' },
    ]);

    expect(models).toEqual({
      'codex:gpt-5.6-sol': {
        provider: 'codex',
        model: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol (ChatGPT)',
      },
      'codex:gpt-5.6-terra': {
        provider: 'codex',
        model: 'gpt-5.6-terra',
        name: 'GPT-5.6 Terra (ChatGPT)',
      },
    });
  });

  it('recognizes and unwraps only valid Codex model keys', () => {
    expect(isCodexModelKey('codex:gpt-5.6-sol')).toBe(true);
    expect(getCodexModelId('codex:gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(isCodexModelKey('gpt-5.6-sol')).toBe(false);
    expect(getCodexModelId('codex:')).toBeUndefined();
  });

  it('keeps the App Server only for a Codex model or an open settings window', () => {
    for (const model of [
      'claude-5-sonnet',
      'gpt-5.6',
      'gemini-3.6-flash',
      'hy-mt2-1.8b',
      'custom-model',
      '',
    ])
      expect(shouldRunCodexServer(model, false)).toBe(false);

    expect(shouldRunCodexServer('codex:gpt-5.6-sol', false)).toBe(true);
    expect(shouldRunCodexServer('codex:gpt-5.6-sol', true)).toBe(true);
    // Settings must be able to sign in and list models before any Codex model is
    // selected.
    expect(shouldRunCodexServer('claude-5-sonnet', true)).toBe(true);
  });

  it('preserves account-specific reasoning and service-tier capabilities', () => {
    const models = toCodexModels([
      {
        model: 'gpt-5.6-sol',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast responses' },
          { reasoningEffort: 'ultra', description: 'Maximum reasoning' },
        ],
        serviceTiers: [{ id: 'priority', name: 'Fast', description: '1.5x speed' }],
      },
    ]);

    expect(models['codex:gpt-5.6-sol']).toMatchObject({
      reasoningEffortOptions: [
        { reasoningEffort: 'low', description: 'Fast responses' },
        { reasoningEffort: 'ultra', description: 'Maximum reasoning' },
      ],
      serviceTiers: [{ id: 'priority', name: 'Fast', description: '1.5x speed' }],
    });
  });
});
